import base64
import io
import json
import math
import os
import random
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path

import numpy as np
from rocketpy import Environment, Flight, Function, Rocket, SolidMotor
from rocketpy.simulation.flight_data_exporter import FlightDataExporter


DATA_DIR = "/home/pyodide/simulation"
ACTIVE_ROCKET_CONFIG = None
DEIMOS_ELEVATION_M = 493.0
DEIMOS_INERTIA_KG_M2 = (0.265, 0.265, 0.00255)
DEIMOS_MOTOR_BURN_TIME_S = 3.048
ATLAS_ELEVATION_M = 488.0
ATLAS_MOTOR_BURN_TIME_S = 5.234
ATLAS_TOTAL_IMPULSE_N_S = 9573.0


def _asset(name):
    if ACTIVE_ROCKET_CONFIG:
        files = ACTIVE_ROCKET_CONFIG.get("arquivos", {})
        for relative_path in files.values():
            if relative_path and (name == relative_path or name == os.path.basename(relative_path)):
                return os.path.join(DATA_DIR, ACTIVE_ROCKET_CONFIG["id"], relative_path)
    return os.path.join(DATA_DIR, name)


def _launch_datetime(params):
    return datetime.fromisoformat(f"{params['launch_date']}T{params['launch_time']}")


def _set_launch_date(env, launch):
    env.set_date(
        (launch.year, launch.month, launch.day, launch.hour, launch.minute),
        timezone="America/Sao_Paulo",
    )


def _vehicle_settings(params):
    if ACTIVE_ROCKET_CONFIG and ACTIVE_ROCKET_CONFIG.get("id") == params.get("vehicle"):
        settings = ACTIVE_ROCKET_CONFIG["ambiente"]
        return {
            "latitude": float(params.get("latitude", settings["latitude"])),
            "longitude": float(params.get("longitude", settings["longitude"])),
            "elevation": float(settings["elevacao_m"]),
            "max_expected_height": float(settings["altura_maxima_m"]),
            "datum": settings["referencial"],
        }
    if params.get("vehicle") == "atlas":
        return {
            "latitude": float(params.get("latitude", -21.9419)),
            "longitude": float(params.get("longitude", -48.9531)),
            "elevation": ATLAS_ELEVATION_M,
            "max_expected_height": 12000,
            "datum": "WGS84",
        }
    return {
        "latitude": float(params.get("latitude", -21.9430589)),
        "longitude": float(params.get("longitude", -48.9524268)),
        "elevation": DEIMOS_ELEVATION_M,
        "max_expected_height": 2500,
        "datum": "SIRGAS2000",
    }


def _environment_from_snapshot(params, snapshot, wind_scales=(1.0, 1.0)):
    settings = _vehicle_settings(params)
    env = Environment(
        latitude=settings["latitude"],
        longitude=settings["longitude"],
        elevation=float(snapshot.get("elevation_m", settings["elevation"])),
        datum=settings["datum"],
        max_expected_height=settings["max_expected_height"],
    )
    launch = _launch_datetime(params)
    _set_launch_date(env, launch)
    env.set_atmospheric_model(
        type="custom_atmosphere",
        pressure=snapshot["pressure"],
        temperature=snapshot["temperature"],
        wind_u=[[h, value * wind_scales[0]] for h, value in snapshot["wind_u"]],
        wind_v=[[h, value * wind_scales[1]] for h, value in snapshot["wind_v"]],
    )
    return env


def _snapshot_environment(env, params, source):
    settings = _vehicle_settings(params)
    heights = np.linspace(0, settings["max_expected_height"], 41)
    return {
        "vehicle": params.get("vehicle", "deimos"),
        "source": source,
        "model": "Open-Meteo" if source == "open-meteo" else ("ECMWF" if source == "windy" else "Cache local"),
        "valid_at": f"{params['launch_date']}T{params['launch_time']}:00-03:00",
        "captured_at": datetime.now().isoformat(timespec="seconds"),
        "latitude": settings["latitude"],
        "longitude": settings["longitude"],
        "elevation_m": float(env.elevation),
        "pressure": [[float(h), float(env.pressure(h))] for h in heights],
        "temperature": [[float(h), float(env.temperature(h))] for h in heights],
        "wind_u": [[float(h), float(env.wind_velocity_x(h))] for h in heights],
        "wind_v": [[float(h), float(env.wind_velocity_y(h))] for h in heights],
    }


def _environment_from_open_meteo(params, response, settings):
    hourly = response.get("hourly") if isinstance(response, dict) else None
    if not isinstance(hourly, dict) or not isinstance(hourly.get("time"), list):
        raise ValueError("A resposta do Open-Meteo não contém dados horários.")

    times = hourly["time"]
    target = _launch_datetime(params)
    available_times = [datetime.fromisoformat(value) for value in times]
    time_index = min(range(len(available_times)), key=lambda index: abs((available_times[index] - target).total_seconds()))
    if abs((available_times[time_index] - target).total_seconds()) > 60 * 60:
        raise ValueError("O horário escolhido não está disponível na previsão do Open-Meteo.")

    def value_at(name):
        values = hourly.get(name)
        if not isinstance(values, list) or time_index >= len(values):
            return None
        value = values[time_index]
        return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else None

    surface_pressure = value_at("surface_pressure")
    surface_temperature = value_at("temperature_2m")
    surface_wind_speed = value_at("wind_speed_10m")
    surface_wind_direction = value_at("wind_direction_10m")
    if None in (surface_pressure, surface_temperature, surface_wind_speed, surface_wind_direction):
        raise ValueError("O Open-Meteo não forneceu todas as variáveis da superfície para esse horário.")

    pressure = [[0.0, surface_pressure * 100.0]]
    temperature = [[0.0, surface_temperature + 273.15]]

    def wind_components(speed, direction):
        angle = math.radians(direction)
        return -speed * math.sin(angle), -speed * math.cos(angle)

    wind_u_surface, wind_v_surface = wind_components(surface_wind_speed, surface_wind_direction)
    wind_u = [[0.0, wind_u_surface]]
    wind_v = [[0.0, wind_v_surface]]

    pressure_levels = (1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100)
    for level in pressure_levels:
        geopotential_height = value_at(f"geopotential_height_{level}hPa")
        level_temperature = value_at(f"temperature_{level}hPa")
        wind_speed = value_at(f"wind_speed_{level}hPa")
        wind_direction = value_at(f"wind_direction_{level}hPa")
        if None in (geopotential_height, level_temperature, wind_speed, wind_direction):
            continue
        altitude_agl = geopotential_height - settings["elevation"]
        if altitude_agl <= 1:
            continue
        wind_u_level, wind_v_level = wind_components(wind_speed, wind_direction)
        pressure.append([altitude_agl, level * 100.0])
        temperature.append([altitude_agl, level_temperature + 273.15])
        wind_u.append([altitude_agl, wind_u_level])
        wind_v.append([altitude_agl, wind_v_level])

    if len(pressure) < 3:
        raise ValueError("A previsão do Open-Meteo não contém níveis atmosféricos suficientes acima do local.")

    env = Environment(
        latitude=settings["latitude"],
        longitude=settings["longitude"],
        elevation=settings["elevation"],
        datum=settings["datum"],
        max_expected_height=settings["max_expected_height"],
    )
    _set_launch_date(env, target)
    env.set_atmospheric_model(
        type="custom_atmosphere",
        pressure=pressure,
        temperature=temperature,
        wind_u=wind_u,
        wind_v=wind_v,
    )
    return env


def build_environment(params, cached_snapshot=None, open_meteo_response=None):
    settings = _vehicle_settings(params)
    if params.get("atmosphere_mode") == "standard":
        env = Environment(
            latitude=settings["latitude"],
            longitude=settings["longitude"],
            elevation=settings["elevation"],
            datum=settings["datum"],
            max_expected_height=settings["max_expected_height"],
        )
        launch = _launch_datetime(params)
        _set_launch_date(env, launch)
        env.set_atmospheric_model(type="standard_atmosphere")
        return env, _snapshot_environment(env, params, "standard"), None

    try:
        if open_meteo_response is None:
            raise RuntimeError(params.get("atmosphere_fetch_error") or "A consulta meteorológica não foi recebida.")
        env = _environment_from_open_meteo(params, open_meteo_response, settings)
        return env, _snapshot_environment(env, params, "open-meteo"), None
    except Exception as error:
        if not cached_snapshot:
            raise RuntimeError(
                f"Não foi possível obter a previsão do Open-Meteo e não existe uma atmosfera salva neste aparelho. Detalhe: {error}"
            ) from error
        env = _environment_from_snapshot(params, cached_snapshot)
        return env, cached_snapshot, f"Open-Meteo indisponível ({error}); foi utilizada a última atmosfera salva neste aparelho."


def _scaled_thrust_source(filename, thrust_scale):
    thrust_source = _asset(filename)
    if abs(thrust_scale - 1.0) <= 1e-9:
        return thrust_source
    points = []
    with open(thrust_source, "r", encoding="utf-8") as source:
        for line in source:
            parts = line.strip().split()
            if len(parts) != 2:
                continue
            try:
                points.append([float(parts[0]), float(parts[1]) * thrust_scale])
            except ValueError:
                continue
    if points and points[0][0] > 0:
        points.insert(0, [0.0, 0.0])
    return np.array(points)


def build_deimos_motor(thrust_scale=1.0, rng=None):
    grain_density = 1500.0
    grain_separation = 0.003
    grain_height = 0.110
    grain_inner_radius = 0.00635
    grain_outer_radius = 0.021
    throat_radius = 0.00475
    nozzle_radius = 0.01185

    if rng is not None:
        grain_density = max(1300, rng.gauss(grain_density, 10))
        grain_separation = max(0.0005, rng.gauss(grain_separation, 0.0005))
        grain_height = max(0.09, rng.gauss(grain_height, 0.001))
        grain_inner_radius = max(0.003, rng.gauss(grain_inner_radius, 0.0002))
        grain_outer_radius = max(grain_inner_radius + 0.005, rng.gauss(grain_outer_radius, 0.0002))
        throat_radius = max(0.003, rng.gauss(throat_radius, 0.0002))
        nozzle_radius = max(throat_radius + 0.003, rng.gauss(nozzle_radius, 0.0001))

    return SolidMotor(
        thrust_source=_scaled_thrust_source("FAISCABATES.eng", thrust_scale),
        reshape_thrust_curve=False,
        dry_mass=0.510,
        dry_inertia=(0.001, 0.001, 0.00004518),
        burn_time=DEIMOS_MOTOR_BURN_TIME_S,
        center_of_dry_mass_position=0.190255,
        grain_number=3,
        grain_density=grain_density,
        grain_outer_radius=grain_outer_radius,
        grain_initial_inner_radius=grain_inner_radius,
        grain_initial_height=grain_height,
        grain_separation=grain_separation,
        grains_center_of_mass_position=0.194148,
        nozzle_position=0,
        nozzle_radius=nozzle_radius,
        throat_radius=throat_radius,
        coordinate_system_orientation="nozzle_to_combustion_chamber",
        interpolation_method="linear",
    )


def build_atlas_motor(params, thrust_scale=1.0):
    return SolidMotor(
        thrust_source=_scaled_thrust_source(
            "Mission7Motor.eng", thrust_scale
        ),
        reshape_thrust_curve=False,
        dry_mass=8.88,
        dry_inertia=(1.065, 1.065, 0.02377),
        nozzle_radius=0.03227,
        grain_number=6,
        grain_density=float(params.get("grain_density_kg_m3", 1730.0)),
        grain_outer_radius=0.045,
        grain_initial_inner_radius=0.01905,
        grain_initial_height=0.140,
        grain_separation=float(params.get("grain_separation_m", 0.012)),
        grains_center_of_mass_position=0.54510,
        center_of_dry_mass_position=0.52105,
        nozzle_position=0,
        throat_radius=0.0135,
        coordinate_system_orientation="nozzle_to_combustion_chamber",
        interpolation_method="linear",
    )


def _atlas_drag_curve(filename, factor=1.0):
    data = np.loadtxt(_asset(filename), delimiter=",", skiprows=1)
    reset_points = np.where(np.diff(data[:, 0]) <= 0)[0]
    if reset_points.size:
        data = data[: reset_points[0] + 1]
    data[:, 1] *= factor
    return Function(data, interpolation="linear", extrapolation="constant")


def build_deimos_rocket(params, rng=None):
    mass = float(params["rocket_mass_kg"])
    cg = float(params["cg_from_tail_m"])
    thrust_scale = 1.0
    parachute_cd_s = 1.561
    parachute_lag = 5.5 if params["flight_case"] == "nominal" else 3.5

    if rng is not None:
        mass = max(0.2, rng.gauss(mass, 0.020))
        cg = rng.gauss(cg, 0.005)
        thrust_scale = max(0.85, rng.gauss(1.0, 0.02))
        parachute_cd_s = max(0.4, rng.gauss(parachute_cd_s, 0.1))
        parachute_lag = max(0, rng.gauss(parachute_lag, 1.0))

    drag_curve_off = Function(
        _asset("CD_Off_RASAero.csv"), interpolation="spline", extrapolation="constant"
    )
    drag_curve_on = Function(
        _asset("CD_On_RASAero.csv"), interpolation="spline", extrapolation="constant"
    )
    rocket = Rocket(
        radius=0.0683 / 2,
        mass=mass,
        inertia=DEIMOS_INERTIA_KG_M2,
        power_off_drag=drag_curve_off,
        power_on_drag=drag_curve_on,
        center_of_mass_without_motor=cg,
        coordinate_system_orientation="tail_to_nose",
    )
    rocket.add_motor(
        build_deimos_motor(thrust_scale=thrust_scale, rng=rng), position=0.005
    )
    nose = rocket.add_nose(
        name="Coifa_Eliptica", length=0.098, kind="elliptical", position=1.315
    )
    fins = rocket.add_trapezoidal_fins(
        n=3,
        root_chord=0.100,
        tip_chord=0.03576,
        span=0.089,
        sweep_length=0.120,
        position=0.166,
    )
    tail = rocket.add_tail(
        name="Boat Tail (Semi-Triangular)",
        top_radius=0.0683 / 2,
        bottom_radius=0.0476 / 2,
        length=0.066,
        position=0.066,
    )
    buttons = rocket.set_rail_buttons(
        upper_button_position=0.862,
        lower_button_position=0.082,
        angular_position=180,
    )
    rocket._plot_components = (nose, fins, tail, buttons)

    flight_case = params["flight_case"]
    if flight_case != "ballistic":
        trigger = "apogee"
        if flight_case == "custom":
            trigger = float(params.get("custom_altitude_m", 300))
            parachute_lag = 3.5 if rng is None else max(0, rng.gauss(3.5, 1.0))
        rocket.add_parachute(
            name="Main",
            cd_s=parachute_cd_s,
            trigger=trigger,
            lag=parachute_lag,
            radius=0.85,
            porosity=0.084775,
            sampling_rate=33,
            height=0.85,
        )
    return rocket


def build_atlas_rocket(params, rng=None):
    mass = float(params.get("rocket_mass_kg", 14.946))
    cg = float(params.get("cg_reference_m", 1.298))
    inertia_xx = float(params.get("inertia_xx_kg_m2", 15.9))
    inertia_zz = float(params.get("inertia_zz_kg_m2", 0.09221))
    thrust_scale = 1.0
    drag_factor = 1.0
    main_cd_s = 5.7123
    drogue_cd_s = 0.9379
    parachute_lag = 0.118

    if rng is not None:
        mass = max(1.0, rng.gauss(mass, 0.2))
        cg = rng.gauss(cg, 0.005)
        thrust_scale = max(
            0.85, rng.gauss(1.0, 200.0 / ATLAS_TOTAL_IMPULSE_N_S)
        )
        drag_factor = max(0.75, rng.gauss(1.0, 0.05))
        main_cd_s = max(0.5, rng.gauss(main_cd_s, 0.2))
        drogue_cd_s = max(0.1, rng.gauss(drogue_cd_s, 0.2))
        parachute_lag = max(0.0, rng.gauss(parachute_lag, 0.032))

    rocket = Rocket(
        radius=0.076,
        mass=mass,
        inertia=(inertia_xx, inertia_xx, inertia_zz),
        power_off_drag=_atlas_drag_curve(
            "Atlas_CD_OR_off.csv", factor=drag_factor
        ),
        power_on_drag=_atlas_drag_curve("Atlas_CD_OR_on.csv", factor=drag_factor),
        center_of_mass_without_motor=cg,
        coordinate_system_orientation="nose_to_tail",
    )
    nose = rocket.add_nose(
        name="Coifa Von Kármán", length=0.850, kind="Von Karman", position=0
    )
    fins = rocket.add_trapezoidal_fins(
        n=4,
        root_chord=0.290,
        tip_chord=0.052,
        span=0.1421,
        position=2.417,
        cant_angle=0,
        sweep_length=0.228,
    )
    rocket.add_motor(
        build_atlas_motor(params, thrust_scale=thrust_scale), position=2.702
    )
    tail = rocket.add_tail(
        name="Boattail Cônico",
        top_radius=0.076,
        bottom_radius=0.0645,
        length=0.300,
        position=2.407,
    )
    buttons = rocket.set_rail_buttons(
        upper_button_position=1.630,
        lower_button_position=2.382,
        angular_position=45,
    )
    rocket._plot_components = (nose, fins, tail, buttons)

    flight_case = params.get("flight_case", "nominal")
    if flight_case == "nominal":
        rocket.add_parachute(
            name="Main Atlas",
            cd_s=main_cd_s,
            trigger=450,
            sampling_rate=50,
            lag=parachute_lag,
        )
        rocket.add_parachute(
            name="Drogue Atlas",
            cd_s=drogue_cd_s,
            trigger="apogee",
            sampling_rate=50,
            lag=parachute_lag,
        )
    elif flight_case == "main_apogee":
        rocket.add_parachute(
            name="Main Atlas",
            cd_s=main_cd_s,
            trigger="apogee",
            sampling_rate=50,
            lag=parachute_lag,
        )
    elif flight_case == "drogue_only":
        rocket.add_parachute(
            name="Drogue Atlas",
            cd_s=drogue_cd_s,
            trigger="apogee",
            sampling_rate=50,
            lag=parachute_lag,
        )
    return rocket


def build_rocket(params, rng=None):
    if ACTIVE_ROCKET_CONFIG and ACTIVE_ROCKET_CONFIG.get("id") == params.get("vehicle"):
        return build_configured_rocket(params, rng=rng)
    if params.get("vehicle") == "atlas":
        return build_atlas_rocket(params, rng=rng)
    return build_deimos_rocket(params, rng=rng)


def build_configured_rocket(params, rng=None):
    """Build a RocketPy vehicle using the declarative manifest v1 format."""
    config = ACTIVE_ROCKET_CONFIG["foguete"]
    motor_config = config["motor"]
    values = dict(motor_config)
    uncertainty = ACTIVE_ROCKET_CONFIG.get("incerteza", {})
    density_key = "grain_density_kg_m3"
    separation_key = "grain_separation_m"
    grain_density = float(params.get(density_key, values["densidade_graos_kg_m3"]))
    grain_separation = float(params.get(separation_key, values["separacao_graos_m"]))
    mass = float(params.get("rocket_mass_kg", config["massa_kg"]))
    cg_key = "cg_reference_m" if config["orientacao"] == "nose_to_tail" else "cg_from_tail_m"
    center_of_mass = float(params.get(cg_key, config["centro_massa_sem_motor_m"]))
    thrust_scale = 1.0
    drag_factor = 1.0
    if rng is not None:
        mass = max(0.1, rng.gauss(mass, float(uncertainty.get("massa_kg", 0.02))))
        center_of_mass = rng.gauss(center_of_mass, float(uncertainty.get("cg_m", 0.005)))
        thrust_scale = max(0.5, rng.gauss(1.0, float(uncertainty.get("escala_empuxo", 0.02))))
        drag_factor = max(0.5, rng.gauss(1.0, float(uncertainty.get("escala_arrasto", 0.02))))
        grain_density = max(1.0, rng.gauss(grain_density, float(uncertainty.get("densidade_graos_kg_m3", 0))))
        grain_separation = max(0.0, rng.gauss(grain_separation, float(uncertainty.get("separacao_graos_m", 0))))
    thrust_source = _asset(ACTIVE_ROCKET_CONFIG["arquivos"]["motor"])
    motor = SolidMotor(
        thrust_source=_scaled_thrust_source(thrust_source, thrust_scale),
        reshape_thrust_curve=False,
        dry_mass=float(values["massa_seca_kg"]),
        dry_inertia=tuple(values["inercia_seca_kg_m2"]),
        burn_time=float(values["tempo_queima_s"]),
        center_of_dry_mass_position=float(values["centro_massa_seco_m"]),
        grain_number=int(values["numero_graos"]),
        grain_density=grain_density,
        grain_outer_radius=float(values["raio_externo_grao_m"]),
        grain_initial_inner_radius=float(values["raio_interno_inicial_grao_m"]),
        grain_initial_height=float(values["altura_inicial_grao_m"]),
        grain_separation=grain_separation,
        grains_center_of_mass_position=float(values["centro_massa_graos_m"]),
        nozzle_position=float(values["posicao_bocal_m"]),
        nozzle_radius=float(values["raio_bocal_m"]),
        throat_radius=float(values["raio_garganta_m"]),
        coordinate_system_orientation=values["orientacao_coordenadas"],
        interpolation_method=values["interpolacao"],
    )

    def drag_function(asset_key):
        filename = _asset(ACTIVE_ROCKET_CONFIG["arquivos"][asset_key])
        table = np.loadtxt(filename, delimiter=",", skiprows=1)
        reset_points = np.where(np.diff(table[:, 0]) <= 0)[0]
        if reset_points.size:
            table = table[: reset_points[0] + 1]
        table[:, 1] *= drag_factor
        drag_settings = ACTIVE_ROCKET_CONFIG.get("arrasto", {})
        return Function(
            table,
            interpolation=drag_settings.get("interpolacao", "linear"),
            extrapolation=drag_settings.get("extrapolacao", "constant"),
        )

    inertia = list(config["inercia_kg_m2"])
    if "inertia_xx_kg_m2" in params:
        inertia[0] = inertia[1] = float(params["inertia_xx_kg_m2"])
    if "inertia_zz_kg_m2" in params:
        inertia[2] = float(params["inertia_zz_kg_m2"])
    rocket = Rocket(
        radius=float(config["raio_m"]),
        mass=mass,
        inertia=tuple(inertia),
        power_off_drag=drag_function("arrasto_desligado"),
        power_on_drag=drag_function("arrasto_ligado"),
        center_of_mass_without_motor=center_of_mass,
        coordinate_system_orientation=config["orientacao"],
    )
    rocket.add_motor(motor, position=float(motor_config["posicao_m"]))
    components = []
    for component in config["componentes"]:
        kind = component["tipo"]
        if kind == "nose":
            value = rocket.add_nose(
                name=component["nome"],
                length=float(component["comprimento_m"]),
                kind=component["formato"],
                position=float(component["posicao_m"]),
            )
        elif kind == "trapezoidal_fins":
            value = rocket.add_trapezoidal_fins(
                n=int(component["numero"]),
                root_chord=float(component["corda_raiz_m"]),
                tip_chord=float(component["corda_ponta_m"]),
                span=float(component["envergadura_m"]),
                position=float(component["posicao_m"]),
                cant_angle=float(component.get("angulo_cant_deg", 0)),
                sweep_length=float(component["comprimento_enflechamento_m"]),
            )
        elif kind == "tail":
            value = rocket.add_tail(
                name=component["nome"],
                top_radius=float(component["raio_superior_m"]),
                bottom_radius=float(component["raio_inferior_m"]),
                length=float(component["comprimento_m"]),
                position=float(component["posicao_m"]),
            )
        elif kind == "rail_buttons":
            value = rocket.set_rail_buttons(
                upper_button_position=float(component["posicao_superior_m"]),
                lower_button_position=float(component["posicao_inferior_m"]),
                angular_position=float(component["angulo_deg"]),
            )
        else:
            raise ValueError(f"Componente RocketPy não suportado no manifesto v1: {kind}")
        components.append(value)
    rocket._plot_components = tuple(components)

    flight_case = params.get("flight_case", "nominal")
    for parachute in config.get("recuperacao", []):
        if flight_case == "ballistic":
            continue
        trigger = parachute["gatilho"]
        cd_s = float(parachute["cd_area_m2"])
        lag = float(parachute.get("atraso_s", parachute.get("atraso_nominal_s", 0)))
        if flight_case != "nominal":
            lag = float(parachute.get("atraso_outros_casos_s", lag))
        if rng is not None:
            cd_s = max(0.1, rng.gauss(cd_s, float(uncertainty.get("cd_recuperacao_m2", 0))))
            lag = max(0.0, rng.gauss(lag, float(uncertainty.get("atraso_recuperacao_s", 0))))
        if flight_case == "main_apogee" and parachute["tipo"] != "main":
            continue
        if flight_case == "drogue_only" and parachute["tipo"] != "drogue":
            continue
        if flight_case == "custom":
            if parachute["tipo"] != "main":
                continue
            trigger = float(params.get("custom_altitude_m", 300))
        rocket.add_parachute(
            name=parachute["nome"],
            cd_s=cd_s,
            trigger=trigger,
            lag=lag,
            radius=float(parachute.get("raio_m", 0.5)),
            porosity=float(parachute.get("porosidade", 0.0)),
            sampling_rate=int(parachute.get("amostragem_hz", 50)),
            height=float(parachute.get("altura_m", 0.5)),
        )
    return rocket


def build_flight(params, env, rng=None):
    inclination = float(params["inclination_deg"])
    heading = float(params["heading_deg"])
    rail_length = float(params["rail_length_m"])
    if rng is not None:
        inclination = min(90, max(1, rng.gauss(inclination, 1.0)))
        if params.get("vehicle") == "atlas":
            heading = rng.gauss(heading, 2.0) % 360
            rail_length = max(0.5, rng.gauss(rail_length, 0.01))
    rocket = build_rocket(params, rng=rng)
    flight = Flight(
        rocket=rocket,
        environment=env,
        rail_length=rail_length,
        inclination=inclination,
        heading=heading,
    )
    return rocket, flight


def _number(value, digits=6):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    return round(value, digits)


def _trajectory(flight):
    times = np.linspace(0, float(flight.t_final), 90)
    return [
        {
            "time_s": _number(time, 3),
            "altitude_agl_m": _number(max(0.0, float(flight.altitude(time))), 3),
            "speed_m_s": _number(flight.speed(time), 3),
            "x_m": _number(flight.x(time), 3),
            "y_m": _number(flight.y(time), 3),
        }
        for time in times
    ]


def _animation_trajectory(flight):
    """Sample position and full 6-DOF attitude only when animation is requested."""
    sample_count = max(120, min(360, int(math.ceil(float(flight.t_final) * 4)) + 1))
    times = np.linspace(0, float(flight.t_final), sample_count)
    trajectory = []
    for time in times:
        trajectory.append(
            {
                "time_s": _number(time, 3),
                "latitude_deg": _number(flight.latitude(time), 7),
                "longitude_deg": _number(flight.longitude(time), 7),
                "altitude_agl_m": _number(max(0.0, float(flight.altitude(time))), 3),
                "e0": _number(flight.e0(time), 8),
                "e1": _number(flight.e1(time), 8),
                "e2": _number(flight.e2(time), 8),
                "e3": _number(flight.e3(time), 8),
            }
        )
    return trajectory


def _wind_point(env, altitude_agl_m):
    altitude_asl_m = float(env.elevation) + float(altitude_agl_m)
    speed = _number(env.wind_speed(altitude_asl_m), 3)
    direction = _number(env.wind_direction(altitude_asl_m), 1)
    heading = _number(env.wind_heading(altitude_asl_m), 1)
    if speed is None or speed < 0.05:
        direction = None
        heading = None
    return {
        "altitude_agl_m": _number(altitude_agl_m, 1),
        "speed_m_s": speed,
        "speed_km_h": _number(speed * 3.6, 2) if speed is not None else None,
        "direction_deg": direction,
        "heading_deg": heading,
        "wind_u_m_s": _number(env.wind_velocity_x(altitude_asl_m), 3),
        "wind_v_m_s": _number(env.wind_velocity_y(altitude_asl_m), 3),
    }


def _wind_profile(env, vehicle):
    altitudes = (0, 100, 250, 500, 750, 1000, 1500, 2000)
    if ACTIVE_ROCKET_CONFIG and ACTIVE_ROCKET_CONFIG.get("id") == vehicle:
        maximum = float(ACTIVE_ROCKET_CONFIG["ambiente"]["altura_maxima_m"])
        altitudes = tuple(sorted(set((0, 100, 250, 500, 1000, maximum * 0.5, maximum))))
    elif vehicle == "atlas":
        altitudes = (0, 100, 250, 500, 1000, 2000, 3000, 5000, 8000, 10000)
    return [
        _wind_point(env, altitude)
        for altitude in altitudes
    ]


def _parachute_visual(vehicle, parachute_name):
    normalized_name = parachute_name.lower()
    if ACTIVE_ROCKET_CONFIG and ACTIVE_ROCKET_CONFIG.get("id") == vehicle:
        for parachute in ACTIVE_ROCKET_CONFIG["foguete"].get("recuperacao", []):
            if parachute["nome"].lower() == normalized_name:
                return {
                    "kind": parachute["tipo"],
                    "diameter_m": float(parachute.get("diametro_m", float(parachute.get("raio_m", 0.5)) * 2)),
                }
    if vehicle == "atlas" and "drogue" in normalized_name:
        return {"kind": "drogue", "diameter_m": 1.20}
    if vehicle == "atlas":
        return {"kind": "main", "diameter_m": 2.71}
    return {"kind": "main", "diameter_m": 1.40}


def _flight_summary(rocket, flight, env, vehicle, include_trajectory=False):
    if ACTIVE_ROCKET_CONFIG and ACTIVE_ROCKET_CONFIG.get("id") == vehicle:
        burn_time = float(ACTIVE_ROCKET_CONFIG["foguete"]["motor"]["tempo_queima_s"])
    else:
        burn_time = (
            ATLAS_MOTOR_BURN_TIME_S
            if vehicle == "atlas"
            else DEIMOS_MOTOR_BURN_TIME_S
        )
    burn_times = np.linspace(0, burn_time, 100)
    max_burn_acceleration = max(abs(float(flight.acceleration(t))) for t in burn_times)
    impact_x = _number(getattr(flight, "x_impact", None), 3)
    impact_y = _number(getattr(flight, "y_impact", None), 3)
    impact_distance = None
    if impact_x is not None and impact_y is not None:
        impact_distance = _number(math.hypot(impact_x, impact_y), 3)

    surface_wind = _wind_point(env, 0)
    parachute_events = getattr(flight, "parachute_events", [])
    parachute_event_details = []
    for trigger_time, parachute in parachute_events:
        name = str(getattr(parachute, "name", "Paraquedas"))
        visual = _parachute_visual(vehicle, name)
        parachute_event_details.append(
            {
                "name": name,
                "kind": visual["kind"],
                "trigger_time_s": _number(trigger_time, 3),
                "deployment_time_s": _number(
                    trigger_time + float(parachute.lag), 3
                ),
                "diameter_m": visual["diameter_m"],
            }
        )
    parachute_event_details.sort(key=lambda event: event["deployment_time_s"])
    parachute_trigger_time = (
        parachute_event_details[0]["trigger_time_s"]
        if parachute_event_details
        else None
    )
    parachute_event_time = (
        parachute_event_details[0]["deployment_time_s"]
        if parachute_event_details
        else None
    )
    result = {
        "apogee_asl_m": _number(flight.apogee, 3),
        "apogee_agl_m": _number(flight.apogee - env.elevation, 3),
        "apogee_time_s": _number(flight.apogee_time, 3),
        "max_speed_m_s": _number(flight.max_speed, 3),
        "max_mach": _number(flight.max_mach_number, 4),
        "max_acceleration_m_s2": _number(flight.max_acceleration, 3),
        "max_burn_acceleration_m_s2": _number(max_burn_acceleration, 3),
        "out_of_rail_velocity_m_s": _number(flight.out_of_rail_velocity, 3),
        "initial_stability_cal": _number(rocket.static_margin(0), 3),
        "out_of_rail_stability_cal": _number(flight.out_of_rail_stability_margin, 3),
        "flight_time_s": _number(flight.t_final, 3),
        "impact_velocity_m_s": _number(abs(flight.impact_velocity), 3),
        "impact_x_m": impact_x,
        "impact_y_m": impact_y,
        "impact_distance_m": impact_distance,
        "surface_wind_m_s": surface_wind["speed_m_s"],
        "surface_wind_km_h": surface_wind["speed_km_h"],
        "surface_wind_direction_deg": surface_wind["direction_deg"],
        "surface_wind_heading_deg": surface_wind["heading_deg"],
        "parachute_trigger_time_s": parachute_trigger_time,
        "parachute_event_time_s": parachute_event_time,
        "parachute_events": parachute_event_details,
    }
    if include_trajectory:
        result["trajectory"] = _trajectory(flight)
        result["wind_profile"] = _wind_profile(env, vehicle)
    return result


def _export_kml(flight):
    """Export the deterministic RocketPy trajectory for Google Earth."""
    file_path = "/tmp/mari_trajectory.kml"
    FlightDataExporter(flight).export_kml(
        file_name=file_path,
        extrude=True,
        altitude_mode="relativetoground",
    )
    return Path(file_path).read_text(encoding="utf-8")


def _capture_detailed_plots(env, rocket, flight):
    """Render the same plot sequence produced by the original notebook's verbose mode."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plots = []
    original_show = plt.show
    active_images = []

    def capture_show(*_args, **_kwargs):
        figure_numbers = list(plt.get_fignums())
        for figure_number in figure_numbers:
            figure = plt.figure(figure_number)
            buffer = io.BytesIO()
            figure.savefig(
                buffer,
                format="png",
                dpi=82,
                bbox_inches="tight",
                facecolor="white",
            )
            active_images.append(
                "data:image/png;base64,"
                + base64.b64encode(buffer.getvalue()).decode("ascii")
            )
            plt.close(figure)

    def run_group(category, labels, action):
        active_images.clear()
        action()
        capture_show()
        for index, image_data_url in enumerate(active_images):
            title = labels[index] if index < len(labels) else f"Gráfico {index + 1}"
            plots.append(
                {
                    "id": f"plot-{len(plots) + 1:02d}",
                    "category": category,
                    "title": title,
                    "image_data_url": image_data_url,
                }
            )

    try:
        plt.show = capture_show
        output_sink = io.StringIO()
        with redirect_stdout(output_sink), redirect_stderr(output_sink):
            run_group(
                "atmosphere",
                ["Resumo atmosférico"],
                env.info,
            )
            run_group(
                "atmosphere",
                ["Modelo atmosférico"],
                env.plots.atmospheric_model,
            )

            nose, fins, tail, buttons = rocket._plot_components
            run_group(
                "aerodynamics",
                ["Geometria da coifa", "Coeficiente de sustentação da coifa"],
                nose.all_info,
            )
            run_group(
                "aerodynamics",
                [
                    "Geometria das aletas",
                    "Momento de rolagem forçante",
                    "Momento de rolagem amortecedor",
                    "Coeficiente de sustentação das aletas",
                    "Sustentação de uma aleta",
                    "Derivada de sustentação das aletas",
                ],
                fins.all_info,
            )
            run_group(
                "aerodynamics",
                ["Coeficiente de sustentação do boat tail"],
                tail.all_info,
            )
            run_group("aerodynamics", [], buttons.all_info)

            run_group(
                "rocket",
                [
                    "Representação do foguete",
                    "Massa total",
                    "Massa reduzida",
                    "Curvas de arrasto",
                    "Margem estática",
                    "Margem de estabilidade por Mach e tempo",
                    "Relação empuxo-peso",
                ],
                rocket.all_info,
            )
            run_group(
                "flight",
                [
                    "Trajetória 3D",
                    "Cinemática da trajetória",
                    "Ângulos de trajetória e atitude",
                    "Posição angular",
                    "Velocidade e aceleração angulares",
                    "Forças aerodinâmicas",
                    "Momentos fletores nos botões da rampa",
                    "Forças nos botões da rampa",
                    "Energia da trajetória",
                    "Mecânica dos fluidos",
                    "Estabilidade e controle",
                    "Pressão na altitude do foguete",
                    "Sinal de pressão do paraquedas",
                ],
                flight.all_info,
            )
    finally:
        plt.show = original_show
        plt.close("all")

    return plots


def _statistics(values):
    array = np.asarray(values, dtype=float)
    return {
        "mean": _number(np.mean(array), 3),
        "std": _number(np.std(array), 3),
        "p05": _number(np.percentile(array, 5), 3),
        "p95": _number(np.percentile(array, 95), 3),
        "min": _number(np.min(array), 3),
        "max": _number(np.max(array), 3),
    }


def run_deimos(params_json, cached_snapshot_json=None, open_meteo_response_json=None, rocket_config_json=None):
    global ACTIVE_ROCKET_CONFIG
    ACTIVE_ROCKET_CONFIG = json.loads(rocket_config_json) if rocket_config_json else None
    params = json.loads(params_json)
    vehicle = params.get("vehicle", "deimos")
    cached_snapshot = json.loads(cached_snapshot_json) if cached_snapshot_json else None
    if cached_snapshot and cached_snapshot.get("vehicle", "deimos") != vehicle:
        cached_snapshot = None
    open_meteo_response = json.loads(open_meteo_response_json) if open_meteo_response_json else None
    env, atmosphere_snapshot, atmosphere_warning = build_environment(
        params, cached_snapshot, open_meteo_response
    )
    rocket, flight = build_flight(params, env)
    deterministic = _flight_summary(
        rocket, flight, env, vehicle, include_trajectory=True
    )
    kml_content = _export_kml(flight)
    vehicle_name = (
        ACTIVE_ROCKET_CONFIG["nome"].lower().replace(" ", "-")
        if ACTIVE_ROCKET_CONFIG and ACTIVE_ROCKET_CONFIG.get("id") == vehicle
        else ("atlas" if vehicle == "atlas" else "deimos-ii")
    )
    launch_stamp = f"{params['launch_date']}-{params['launch_time'].replace(':', '')}"
    kml_file_name = f"trajetoria-{vehicle_name}-{launch_stamp}.kml"

    requested_simulations = max(1, min(int(params.get("number_of_simulations", 1)), 100))
    monte_carlo = None
    if requested_simulations > 1:
        rng = random.Random(int(params.get("random_seed", 1202)))
        samples = []
        wind_sigma = 0.10 if vehicle == "atlas" else 0.15
        for index in range(requested_simulations):
            sample_env = _environment_from_snapshot(
                params,
                atmosphere_snapshot,
                wind_scales=(
                    max(0.2, rng.gauss(1, wind_sigma)),
                    max(0.2, rng.gauss(1, wind_sigma)),
                ),
            )
            sample_rocket, sample_flight = build_flight(params, sample_env, rng=rng)
            samples.append(
                _flight_summary(sample_rocket, sample_flight, sample_env, vehicle)
            )
            try:
                progress_callback(index + 1, requested_simulations)
            except NameError:
                pass

        monte_carlo = {
            "count": requested_simulations,
            "apogee_agl_m": _statistics([sample["apogee_agl_m"] for sample in samples]),
            "impact_velocity_m_s": _statistics([sample["impact_velocity_m_s"] for sample in samples]),
            "impact_points": [
                {"x_m": sample["impact_x_m"], "y_m": sample["impact_y_m"]}
                for sample in samples
            ],
        }

    detailed_plots = []
    plot_warning = None
    if params.get("verbose"):
        try:
            plot_progress_callback()
        except NameError:
            pass
        try:
            detailed_plots = _capture_detailed_plots(env, rocket, flight)
        except Exception as error:
            plot_warning = f"A simulação terminou, mas os gráficos não puderam ser gerados: {error}"

    animation_trajectory = None
    if params.get("animate_trajectory"):
        try:
            animation_progress_callback()
        except NameError:
            pass
        animation_trajectory = _animation_trajectory(flight)

    if ACTIVE_ROCKET_CONFIG and ACTIVE_ROCKET_CONFIG.get("id") == vehicle:
        inertia_values = list(ACTIVE_ROCKET_CONFIG["foguete"]["inercia_kg_m2"])
        if "inertia_xx_kg_m2" in params:
            inertia_values[0] = inertia_values[1] = float(params["inertia_xx_kg_m2"])
        if "inertia_zz_kg_m2" in params:
            inertia_values[2] = float(params["inertia_zz_kg_m2"])
        inertia = tuple(inertia_values)
        model_warning = None
    elif vehicle == "atlas":
        inertia = (
            float(params.get("inertia_xx_kg_m2", 15.9)),
            float(params.get("inertia_xx_kg_m2", 15.9)),
            float(params.get("inertia_zz_kg_m2", 0.09221)),
        )
        model_warning = None
    else:
        inertia = DEIMOS_INERTIA_KG_M2
        model_warning = None

    return json.dumps(
        {
            "schema_version": 7,
            "vehicle": vehicle,
            "deterministic": deterministic,
            "kml_content": kml_content,
            "kml_file_name": kml_file_name,
            "monte_carlo": monte_carlo,
            "detailed_plots": detailed_plots,
            "detailed_plots_requested": bool(params.get("verbose")),
            "plot_warning": plot_warning,
            "animation_trajectory": animation_trajectory,
            "atmosphere": atmosphere_snapshot,
            "atmosphere_warning": atmosphere_warning,
            "model_warning": model_warning,
            "inertia_kg_m2": inertia,
        },
        allow_nan=False,
    )
