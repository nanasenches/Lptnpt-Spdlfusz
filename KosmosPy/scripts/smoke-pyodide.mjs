import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadPyodide } from "pyodide";

const root = resolve(import.meta.dirname, "..");
const simulationDir = resolve(root, "public", "simulation");
const simulationCount = Math.max(1, Number.parseInt(process.argv[2] ?? "1", 10));
const atmosphereMode = ["forecast", "open-meteo", "windy"].includes(process.argv[3]) ? "forecast" : "standard";
const supportedCases = new Set(["nominal", "ballistic", "main_apogee", "drogue_only", "custom"]);
const flightCase = supportedCases.has(process.argv[4]) ? process.argv[4] : "nominal";
const verbose = process.argv[5] === "verbose";
const vehicle = process.argv[6] === "atlas" ? "atlas" : "deimos";
const outputPath = process.argv[7];

const localPyodideDir = resolve(root, "public", "pyodide");
const pyodide = await loadPyodide({ indexURL: localPyodideDir });
await pyodide.loadPackage([
  "micropip",
  "numpy",
  "scipy",
  "matplotlib",
  "netcdf4",
  "requests",
  "pytz",
]);
const localWheelNames = [
  "dill-0.4.1-py3-none-any.whl",
  "simplekml-1.3.5-py3-none-any.whl",
  "rocketpy-1.13.0-py3-none-any.whl",
];
const localWheels = [];
for (const name of localWheelNames) {
  pyodide.FS.writeFile(`/tmp/${name}`, await readFile(resolve(root, "public", "pyodide", name)));
  localWheels.push(`emfs:/tmp/${name}`);
}
pyodide.globals.set("smoke_local_wheels_json", JSON.stringify(localWheels));
await pyodide.runPythonAsync(`
import json
import micropip
await micropip.install(json.loads(smoke_local_wheels_json), deps=False)
`);
pyodide.globals.delete("smoke_local_wheels_json");

pyodide.FS.mkdirTree("/home/pyodide/simulation");
for (const file of [
  "FAISCABATES.eng",
  "CD_Off_RASAero.csv",
  "CD_On_RASAero.csv",
  "deimos_core.py",
  "Mission7Motor.eng",
  "Atlas_CD_OR_off.csv",
  "Atlas_CD_OR_on.csv",
]) {
  const contents = await readFile(resolve(simulationDir, file));
  pyodide.FS.writeFile(`/home/pyodide/simulation/${file}`, contents);
}

await pyodide.runPythonAsync(`
exec(open("/home/pyodide/simulation/deimos_core.py", encoding="utf-8").read(), globals())
`);

const params = {
  vehicle,
  launch_date: vehicle === "atlas" ? "2026-09-04" : "2026-09-03",
  launch_time: vehicle === "atlas" ? "11:00" : "08:00",
  latitude: vehicle === "atlas" ? -21.9419 : -21.9430589,
  longitude: vehicle === "atlas" ? -48.9531 : -48.9524268,
  rocket_mass_kg: vehicle === "atlas" ? 14.946 : 2.79,
  cg_from_tail_m: 0.686,
  cg_reference_m: vehicle === "atlas" ? 1.298 : 0.686,
  inertia_xx_kg_m2: vehicle === "atlas" ? 15.9 : 0.265,
  inertia_zz_kg_m2: vehicle === "atlas" ? 0.09221 : 0.00255,
  grain_density_kg_m3: 1730,
  grain_separation_m: 0.012,
  number_of_simulations: simulationCount,
  inclination_deg: 80,
  rail_length_m: vehicle === "atlas" ? 6 : 4,
  heading_deg: vehicle === "atlas" ? 90 : 330,
  flight_case: flightCase,
  custom_altitude_m: 300,
  verbose,
  animate_trajectory: true,
  atmosphere_mode: atmosphereMode,
  random_seed: 1202,
};

pyodide.globals.set("smoke_params_json", JSON.stringify(params));
let openMeteoResponse = null;
if (atmosphereMode === "forecast") {
  const levels = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100];
  const hourly = ["temperature_2m", "surface_pressure", "wind_speed_10m", "wind_direction_10m"];
  for (const level of levels) {
    hourly.push(`temperature_${level}hPa`, `geopotential_height_${level}hPa`, `wind_speed_${level}hPa`, `wind_direction_${level}hPa`);
  }
  const query = new URLSearchParams({
    latitude: String(params.latitude),
    longitude: String(params.longitude),
    hourly: hourly.join(","),
    start_date: params.launch_date,
    end_date: params.launch_date,
    timezone: "America/Sao_Paulo",
    wind_speed_unit: "ms",
  });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const endpoint = params.launch_date < today
    ? "https://historical-forecast-api.open-meteo.com/v1/forecast"
    : "https://api.open-meteo.com/v1/forecast";
  const response = await fetch(`${endpoint}?${query.toString()}`);
  if (!response.ok) throw new Error(`Open-Meteo respondeu com HTTP ${response.status}.`);
  openMeteoResponse = await response.json();
}
pyodide.globals.set(
  "smoke_open_meteo_response_json",
  openMeteoResponse ? JSON.stringify(openMeteoResponse) : null,
);
const raw = await pyodide.runPythonAsync(
  "run_deimos(smoke_params_json, None, smoke_open_meteo_response_json)",
);
const result = JSON.parse(raw);
if (outputPath) await writeFile(resolve(root, outputPath), JSON.stringify(result));

if (result.schema_version !== 7) {
  throw new Error(`Schema inesperado: ${result.schema_version}.`);
}
if (!Array.isArray(result.animation_trajectory) || result.animation_trajectory.length < 120) {
  throw new Error("A trajetória de animação não foi calculada.");
}
if (
  result.animation_trajectory.some((point) =>
    [point.time_s, point.latitude_deg, point.longitude_deg, point.altitude_agl_m, point.e0, point.e1, point.e2, point.e3]
      .some((value) => !Number.isFinite(value)),
  )
) {
  throw new Error("A trajetória de animação contém posição ou atitude inválida.");
}
if (flightCase === "ballistic") {
  if (result.deterministic.parachute_event_time_s !== null || result.deterministic.parachute_events.length !== 0) {
    throw new Error("O voo balístico não deveria ter evento de paraquedas.");
  }
} else if (
  !Number.isFinite(result.deterministic.parachute_event_time_s) ||
  result.deterministic.parachute_event_time_s <= result.deterministic.apogee_time_s
) {
  throw new Error("O instante de acionamento do paraquedas é inválido.");
}
if (vehicle === "atlas") {
  const expectedEvents = flightCase === "nominal" ? 2 : flightCase === "ballistic" ? 0 : 1;
  if (result.deterministic.parachute_events.length !== expectedEvents) {
    throw new Error(`O Atlas produziu ${result.deterministic.parachute_events.length} eventos de recuperação; eram esperados ${expectedEvents}.`);
  }
  if (result.inertia_kg_m2[0] !== 15.9 || result.inertia_kg_m2[2] !== 0.09221) {
    throw new Error("As inércias finais do Atlas não foram aplicadas.");
  }
}
if (vehicle === "deimos") {
  if (result.deterministic.parachute_events[0]?.diameter_m !== 1.4 && flightCase !== "ballistic") {
    throw new Error("O diâmetro visual do paraquedas do DEIMOS II foi alterado.");
  }
}
if (!result.kml_content?.includes('<altitudeMode>relativeToGround</altitudeMode>')) {
  throw new Error('O KML não usa altitude relativa ao terreno.');
}
if (!result.kml_content?.includes('<extrude>1</extrude>')) {
  throw new Error('O KML não projeta a trajetória até o solo.');
}
if (!result.kml_file_name?.endsWith('.kml')) {
  throw new Error('O nome do arquivo KML é inválido.');
}

if (!(result.deterministic.apogee_agl_m > 0)) {
  throw new Error("A simulação não produziu um apogeu válido.");
}
const trajectory = result.deterministic.trajectory;
if (Math.abs(trajectory[0].altitude_agl_m) > 0.001) {
  throw new Error(
    `O perfil de altitude não começou em 0 m AGL: ${trajectory[0].altitude_agl_m}`,
  );
}
const trajectoryApogee = Math.max(...trajectory.map((point) => point.altitude_agl_m));
if (Math.abs(trajectoryApogee - result.deterministic.apogee_agl_m) > 10) {
  throw new Error("O perfil de altitude não coincide com o apogeu AGL.");
}
if (result.deterministic.wind_profile?.[0]?.altitude_agl_m !== 0) {
  throw new Error("O perfil de vento não começou na superfície.");
}
if ("inertia_warning" in result) {
  throw new Error("O aviso de inércias ainda está presente no resultado.");
}
if (vehicle === "atlas" && result.model_warning !== null) {
  throw new Error("O aviso provisório do Atlas ainda está presente.");
}
if (simulationCount > 1 && result.monte_carlo?.count !== simulationCount) {
  throw new Error("A análise de dispersão não produziu a quantidade solicitada.");
}
if (verbose) {
  const expectedPlotCount = vehicle === "atlas"
    ? (flightCase === "ballistic" ? 30 : 31)
    : (flightCase === "ballistic" ? 29 : 30);
  if (result.detailed_plots?.length !== expectedPlotCount) {
    throw new Error(
      `Foram gerados ${result.detailed_plots?.length ?? 0} gráficos detalhados; eram esperados ${expectedPlotCount}.`,
    );
  }
  if (
    result.detailed_plots.some(
      (plot) => !plot.image_data_url?.startsWith("data:image/png;base64,"),
    )
  ) {
    throw new Error("Um ou mais gráficos detalhados não são imagens PNG válidas.");
  }
  if (result.detailed_plots.some((plot) => /^Gráfico \d+$/.test(plot.title))) {
    throw new Error("Um ou mais gráficos detalhados ainda estão sem título descritivo.");
  }
}

if (atmosphereMode === "forecast") {
  pyodide.globals.set(
    "smoke_cached_snapshot_json",
    JSON.stringify(result.atmosphere),
  );
  const cachedRaw = await pyodide.runPythonAsync(
    "run_deimos(smoke_params_json, smoke_cached_snapshot_json, None)",
  );
  const cachedResult = JSON.parse(cachedRaw);
  if (!cachedResult.atmosphere_warning?.includes("última atmosfera salva")) {
    throw new Error("A recuperação da atmosfera salva não foi acionada.");
  }
}

console.log(JSON.stringify({
  apogee_agl_m: result.deterministic.apogee_agl_m,
  max_speed_m_s: result.deterministic.max_speed_m_s,
  flight_time_s: result.deterministic.flight_time_s,
  impact_velocity_m_s: result.deterministic.impact_velocity_m_s,
  monte_carlo_count: result.monte_carlo?.count ?? 0,
  flight_case: flightCase,
  atmosphere: atmosphereMode,
  initial_altitude_agl_m: trajectory[0].altitude_agl_m,
  surface_wind_m_s: result.deterministic.surface_wind_m_s,
  surface_wind_direction_deg: result.deterministic.surface_wind_direction_deg,
  surface_wind_heading_deg: result.deterministic.surface_wind_heading_deg,
  warning: result.inertia_warning,
  model_warning: result.model_warning,
  vehicle,
  detailed_plot_count: result.detailed_plots?.length ?? 0,
  detailed_plot_payload_mb: Number(
    (JSON.stringify(result.detailed_plots ?? []).length / 1024 / 1024).toFixed(2),
  ),
  kml_file_name: result.kml_file_name,
  kml_size_kb: Number((result.kml_content.length / 1024).toFixed(2)),
  animation_point_count: result.animation_trajectory?.length ?? 0,
  parachute_event_time_s: result.deterministic.parachute_event_time_s,
}, null, 2));
