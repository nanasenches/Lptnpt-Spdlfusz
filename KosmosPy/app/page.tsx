'use client';

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  Gauge,
  HardDrive,
  Images,
  MapPinned,
  Navigation,
  Play,
  Rocket,
  RotateCcw,
  Ruler,
  SlidersHorizontal,
  Timer,
  Wind,
  ZoomIn,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrajectoryMap3D } from '@/components/trajectory-map-3d';
import {
  downloadRocketPackage,
  fetchRocketCatalog,
  getInstalledRocket,
  getPackageAsset,
  getInstalledRockets,
  type InstalledRocket,
  type RocketCatalog,
  type RocketCatalogEntry,
} from '@/lib/rocket-catalog';

type FlightCase = 'nominal' | 'ballistic' | 'main_apogee' | 'drogue_only' | 'custom';
type Verbose = 'false' | 'true';
type Vehicle = string;
type OfflineState = 'checking' | 'not-ready' | 'preparing' | 'ready' | 'unsupported' | 'error';
type CatalogState = 'checking' | 'ready' | 'offline' | 'error';

type FormState = {
  [key: string]: string | number | boolean;
  launch_date: string;
  launch_time: string;
  latitude: string;
  longitude: string;
  rocket_mass_kg: string;
  cg_from_tail_m: string;
  cg_reference_m: string;
  inertia_xx_kg_m2: string;
  inertia_zz_kg_m2: string;
  grain_density_kg_m3: string;
  grain_separation_m: string;
  number_of_simulations: string;
  inclination_deg: string;
  rail_length_m: string;
  heading_deg: string;
  flight_case: FlightCase;
  custom_altitude_m: string;
  verbose: Verbose;
  animate_trajectory: boolean;
  atmosphere_mode: 'forecast' | 'standard';
  random_seed: number;
};

type FlightSummary = {
  apogee_asl_m: number;
  apogee_agl_m: number;
  apogee_time_s: number;
  max_speed_m_s: number;
  max_mach: number;
  max_acceleration_m_s2: number;
  max_burn_acceleration_m_s2: number;
  out_of_rail_velocity_m_s: number;
  initial_stability_cal: number;
  out_of_rail_stability_cal: number;
  flight_time_s: number;
  impact_velocity_m_s: number;
  impact_x_m: number;
  impact_y_m: number;
  impact_distance_m: number;
  surface_wind_m_s: number;
  surface_wind_km_h?: number;
  surface_wind_direction_deg?: number | null;
  surface_wind_heading_deg?: number | null;
  parachute_event_time_s?: number | null;
  parachute_events?: Array<{
    name: string;
    kind: 'main' | 'drogue';
    trigger_time_s: number;
    deployment_time_s: number;
    diameter_m: number;
  }>;
  wind_profile?: Array<{
    altitude_agl_m: number;
    speed_m_s: number;
    speed_km_h: number;
    direction_deg: number | null;
    heading_deg: number | null;
    wind_u_m_s: number;
    wind_v_m_s: number;
  }>;
  trajectory?: Array<{
    time_s: number;
    altitude_agl_m: number;
    speed_m_s: number;
    x_m: number;
    y_m: number;
  }>;
};

type Stat = { mean: number; std: number; p05: number; p95: number; min: number; max: number };

type DetailedPlot = {
  id: string;
  category: 'atmosphere' | 'aerodynamics' | 'rocket' | 'flight';
  title: string;
  image_data_url: string;
};

type SimulationResult = {
  schema_version: number;
  vehicle: Vehicle;
  deterministic: FlightSummary;
  kml_content: string;
  kml_file_name: string;
  monte_carlo: null | {
    count: number;
    apogee_agl_m: Stat;
    impact_velocity_m_s: Stat;
    impact_points: Array<{ x_m: number; y_m: number }>;
  };
  detailed_plots: DetailedPlot[];
  detailed_plots_requested?: boolean;
  plot_warning?: string | null;
  animation_trajectory: null | Array<{
    time_s: number;
    latitude_deg: number;
    longitude_deg: number;
    altitude_agl_m: number;
    e0: number;
    e1: number;
    e2: number;
    e3: number;
  }>;
  atmosphere: {
    source: string;
    model: string;
    valid_at: string;
    captured_at: string;
    pressure: number[][];
    temperature: number[][];
    wind_u: number[][];
    wind_v: number[][];
  };
  atmosphere_warning: string | null;
  model_warning: string | null;
  inertia_kg_m2: number[];
};

type KmlExporterPlugin = {
  open(options: { content: string; fileName: string }): Promise<void>;
};

const KmlExporter = registerPlugin<KmlExporterPlugin>('KmlExporter');
const ExternalLink = registerPlugin<{ open(options: { url: string }): Promise<void> }>('ExternalLink');

const DEIMOS_FORM: FormState = {
  launch_date: '2026-09-03',
  launch_time: '08:00',
  latitude: '-21.9430589',
  longitude: '-48.9524268',
  rocket_mass_kg: '2.790',
  cg_from_tail_m: '0.686',
  cg_reference_m: '0.686',
  inertia_xx_kg_m2: '0.265',
  inertia_zz_kg_m2: '0.00255',
  grain_density_kg_m3: '1500',
  grain_separation_m: '0.003',
  number_of_simulations: '1',
  inclination_deg: '80',
  rail_length_m: '4.0',
  heading_deg: '330',
  flight_case: 'nominal',
  custom_altitude_m: '300',
  verbose: 'true',
  animate_trajectory: false,
  atmosphere_mode: 'forecast',
  random_seed: 1202,
};

const ATLAS_FORM: FormState = {
  launch_date: '2026-09-04',
  launch_time: '11:00',
  latitude: '-21.9419',
  longitude: '-48.9531',
  rocket_mass_kg: '14.946',
  cg_from_tail_m: '1.409',
  cg_reference_m: '1.298',
  inertia_xx_kg_m2: '15.9',
  inertia_zz_kg_m2: '0.09221',
  grain_density_kg_m3: '1730',
  grain_separation_m: '0.012',
  number_of_simulations: '1',
  inclination_deg: '80',
  rail_length_m: '6.0',
  heading_deg: '90',
  flight_case: 'nominal',
  custom_altitude_m: '450',
  verbose: 'true',
  animate_trajectory: false,
  atmosphere_mode: 'forecast',
  random_seed: 1202,
};

const trajectoryConfig = {
  altitude_agl_m: { label: 'Altitude AGL', color: 'var(--chart-1)' },
  speed_m_s: { label: 'Velocidade', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const impactConfig = {
  impact: { label: 'Pontos de impacto', color: 'var(--chart-3)' },
} satisfies ChartConfig;

const PLOT_GROUPS: Array<{
  id: DetailedPlot['category'];
  label: string;
  description: string;
}> = [
  { id: 'atmosphere', label: 'Atmosfera', description: 'Perfis e modelo atmosférico do local.' },
  { id: 'aerodynamics', label: 'Geometria e aerodinâmica', description: 'Coifa, aletas e boat tail.' },
  { id: 'rocket', label: 'Foguete', description: 'Massa, arrasto, estabilidade e empuxo-peso.' },
  { id: 'flight', label: 'Voo', description: 'Trajetória, atitude, forças, energia, fluidos e recuperação.' },
];

const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const OPEN_METEO_PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100];

function openMeteoForecastUrl(form: FormState) {
  const hourly = ['temperature_2m', 'surface_pressure', 'wind_speed_10m', 'wind_direction_10m'];
  for (const level of OPEN_METEO_PRESSURE_LEVELS) {
    hourly.push(
      `temperature_${level}hPa`,
      `geopotential_height_${level}hPa`,
      `wind_speed_${level}hPa`,
      `wind_direction_${level}hPa`,
    );
  }
  const query = new URLSearchParams({
    latitude: String(form.latitude),
    longitude: String(form.longitude),
    hourly: hourly.join(','),
    start_date: form.launch_date,
    end_date: form.launch_date,
    timezone: 'America/Sao_Paulo',
    wind_speed_unit: 'ms',
  });
  const today = todayInSaoPaulo();
  const endpoint = form.launch_date < today
    ? 'https://historical-forecast-api.open-meteo.com/v1/forecast'
    : 'https://api.open-meteo.com/v1/forecast';
  return `${endpoint}?${query.toString()}`;
}

function todayInSaoPaulo() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatNumber(value: number | null | undefined, suffix = '') {
  if (value == null || Number.isNaN(value)) return '—';
  return `${numberFormatter.format(value)}${suffix}`;
}

const compassPoints = ['N', 'NNE', 'NE', 'ENE', 'L', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

function formatBearing(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  const normalized = (value + 360) % 360;
  const compass = compassPoints[Math.round(normalized / 22.5) % compassPoints.length];
  return `${compass} · ${numberFormatter.format(normalized)}°`;
}

function Field({ id, label, unit, children }: { id: string; label: string; unit?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {unit ? <span className="text-[11px] text-muted-foreground">{unit}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Metric({ icon: Icon, label, value, emphasis = false }: { icon: typeof Gauge; label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl border p-3.5 ${emphasis ? 'border-primary/25 bg-primary/[0.06]' : 'border-border/70 bg-background/65'}`}>
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</span>
      </div>
      <div className="font-mono text-[1.15rem] font-semibold tracking-tight">{value}</div>
    </div>
  );
}

/* oxlint-disable next/no-img-element -- Matplotlib returns runtime data URLs with variable aspect ratios. */
function DetailedPlotImage({ plot }: { plot: DetailedPlot }) {
  return <img src={plot.image_data_url} alt={plot.title} loading="lazy" decoding="async" className="h-auto w-full rounded-md object-contain" />;
}
/* oxlint-enable next/no-img-element */

/* oxlint-disable next/no-img-element -- User-provided Kosmos brand asset is shared by the web and native builds. */
function KosmosLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden bg-white ${compact ? 'h-10 w-14 rounded-xl p-1.5 shadow-sm ring-1 ring-black/10' : 'h-20 w-28 rounded-2xl p-2.5 shadow-xl shadow-black/25 ring-1 ring-white/15'}`}>
      <img src="/branding/kosmos-logo.png" alt="Logo da Kosmos Rocketry" className="h-full w-full object-contain" />
    </div>
  );
}
/* oxlint-enable next/no-img-element */

function DeveloperCredit({ className = '' }: { className?: string }) {
  return <p className={`text-center text-[11px] tracking-[0.08em] ${className}`}>Made by: André Becker - Skunk Works Division.</p>;
}

function compareVersionNames(left: string, right: string): number | null {
  const parse = (value: string) => {
    const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

export default function Home() {
  const nativeRuntime = Capacitor.isNativePlatform();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [selectedRocket, setSelectedRocket] = useState<InstalledRocket | null>(null);
  const [form, setForm] = useState<FormState>(DEIMOS_FORM);
  const [engineState, setEngineState] = useState<'loading' | 'ready' | 'running' | 'error'>('loading');
  const [status, setStatus] = useState('Iniciando o motor de cálculo…');
  const [progress, setProgress] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [offlineState, setOfflineState] = useState<OfflineState>(nativeRuntime ? 'ready' : 'checking');
  const [offlineProgress, setOfflineProgress] = useState(nativeRuntime ? 100 : 0);
  const [offlineMessage, setOfflineMessage] = useState(nativeRuntime ? 'Motor e arquivos incorporados ao aplicativo.' : 'Verificando armazenamento offline…');
  const [savedAtmospheres, setSavedAtmospheres] = useState({ deimos: false, atlas: false });
  const [catalog, setCatalog] = useState<RocketCatalog | null>(null);
  const [bundledCatalog, setBundledCatalog] = useState<RocketCatalog | null>(null);
  const [installedRockets, setInstalledRockets] = useState<InstalledRocket[]>([]);
  const [catalogState, setCatalogState] = useState<CatalogState>('checking');
  const [catalogMessage, setCatalogMessage] = useState('Consultando o catálogo público…');
  const [downloadingRocket, setDownloadingRocket] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateNoticeOpen, setUpdateNoticeOpen] = useState(false);
  const [apkUpdate, setApkUpdate] = useState<{ versionName: string; downloadUrl: string } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    let disposed = false;

    async function refreshRocketCatalog() {
      try {
        const bundledResponse = await fetch('/foguetes/catalogo.json', { cache: 'no-store' });
        const bundled = bundledResponse.ok ? await bundledResponse.json() as RocketCatalog : null;
        if (!disposed) setBundledCatalog(bundled);
        const saved = await getInstalledRockets();
        if (disposed) return;
        setInstalledRockets(saved);
        const remoteCatalog = await fetchRocketCatalog();
        if (disposed) return;
        const remoteIds = new Set(remoteCatalog.foguetes.map((entry) => entry.id));
        const retainedPackages = saved
          .filter((rocket) => !remoteIds.has(rocket.manifest.id))
          .map((rocket) => ({
            id: rocket.manifest.id,
            nome: rocket.manifest.nome,
            versao_dados: rocket.manifest.versao_dados,
            manifesto: `${rocket.manifest.id}/manifest.json`,
          }));
        const visibleCatalog = {
          ...remoteCatalog,
          foguetes: [...remoteCatalog.foguetes, ...retainedPackages].sort((a, b) => a.id.localeCompare(b.id)),
        };
        setCatalog(visibleCatalog);
        localStorage.setItem('mari:rocket-catalog:v1', JSON.stringify(visibleCatalog));
        setCatalogState('ready');
        const updates = remoteCatalog.foguetes.filter((entry) => {
          const installed = saved.find((rocket) => rocket.manifest.id === entry.id);
          const bundledVersion = bundled?.foguetes.find((item) => item.id === entry.id)?.versao_dados;
          const currentVersion = installed?.manifest.versao_dados ?? bundledVersion;
          return !currentVersion || currentVersion !== entry.versao_dados;
        });
        setCatalogMessage(updates.length
          ? `${updates.length} pacote${updates.length === 1 ? '' : 's'} novo${updates.length === 1 ? '' : 's'} disponível${updates.length === 1 ? '' : 'is'}.`
          : 'Catálogo sincronizado. Os pacotes baixados ficam disponíveis sem internet.');
        const dismissedVersion = localStorage.getItem('mari:catalog-notice-dismissed');
        const noticeVersion = updates.map((entry) => `${entry.id}@${entry.versao_dados}`).sort().join('|');
        if (updates.length && dismissedVersion !== noticeVersion) setUpdateNoticeOpen(true);
      } catch (error) {
        if (disposed) return;
        const savedCatalogText = localStorage.getItem('mari:rocket-catalog:v1');
        const savedPackages = await getInstalledRockets().catch(() => []);
        if (disposed) return;
        setInstalledRockets(savedPackages);
        if (savedCatalogText) {
          try {
            setCatalog(JSON.parse(savedCatalogText) as RocketCatalog);
            setCatalogState('offline');
            setCatalogMessage('Sem internet. Exibindo o último catálogo consultado e os pacotes salvos.');
            return;
          } catch {
            localStorage.removeItem('mari:rocket-catalog:v1');
          }
        }
        const bundledResponse = await fetch('/foguetes/catalogo.json').catch(() => null);
        if (bundledResponse?.ok) {
          const bundled = await bundledResponse.json() as RocketCatalog;
          setBundledCatalog(bundled);
          const bundledIds = new Set(bundled.foguetes.map((entry) => entry.id));
          const retainedPackages = savedPackages
            .filter((rocket) => !bundledIds.has(rocket.manifest.id))
            .map((rocket) => ({
              id: rocket.manifest.id,
              nome: rocket.manifest.nome,
              versao_dados: rocket.manifest.versao_dados,
              manifesto: `${rocket.manifest.id}/manifest.json`,
            }));
          setCatalog({ ...bundled, foguetes: [...bundled.foguetes, ...retainedPackages].sort((a, b) => a.id.localeCompare(b.id)) });
          setCatalogState('offline');
          setCatalogMessage('Sem internet. Exibindo os dados incluídos no APK e os pacotes salvos.');
          return;
        }
        setCatalogState(savedPackages.length ? 'offline' : 'error');
        setCatalogMessage(savedPackages.length
          ? 'Sem internet. Os pacotes salvos continuam neste aparelho.'
          : `Não foi possível consultar o catálogo: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    void refreshRocketCatalog();
    window.addEventListener('online', refreshRocketCatalog);
    return () => {
      disposed = true;
      window.removeEventListener('online', refreshRocketCatalog);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    async function checkApkRelease() {
      try {
        const [installedResponse, releaseResponse] = await Promise.all([
          fetch('/app-version.json', { cache: 'no-store' }),
          fetch('https://api.github.com/repos/nanasenches/Lptnpt-Spdlfusz/releases/latest', {
            cache: 'no-store',
            headers: { Accept: 'application/vnd.github+json' },
          }),
        ]);
        if (!installedResponse.ok || !releaseResponse.ok) return;
        const installedVersion = await installedResponse.json() as { versionName?: string };
        const release = await releaseResponse.json() as {
          tag_name?: string;
          html_url?: string;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        const apkAsset = release.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.apk'));
        const publishedVersion = release.tag_name?.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1]
          ?? apkAsset?.name?.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
        const target = apkAsset?.browser_download_url ?? release.html_url;
        if (disposed || !publishedVersion || !target || !installedVersion.versionName) return;
        if (compareVersionNames(publishedVersion, installedVersion.versionName) <= 0) return;
        setApkUpdate({ versionName: publishedVersion, downloadUrl: target });
        if (localStorage.getItem('mari:apk-notice-dismissed') !== publishedVersion) setUpdateNoticeOpen(true);
      } catch {
        // A failed release check should not block app startup or offline use.
      }
    }
    void checkApkRelease();
    window.addEventListener('online', checkApkRelease);
    return () => {
      disposed = true;
      window.removeEventListener('online', checkApkRelease);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let worker: Worker | null = null;
    let reloadingForUpdate = false;
    const controlledAtStartup = Boolean(navigator.serviceWorker?.controller);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const atmosphereCheck = window.setTimeout(() => {
      setSavedAtmospheres({
        deimos: Boolean(localStorage.getItem('rocket:deimos:atmosphere')),
        atlas: Boolean(localStorage.getItem('rocket:atlas:atmosphere')),
      });
    }, 0);

    const onServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message?.type === 'OFFLINE_STATUS') {
        setOfflineState(message.ready ? 'ready' : 'not-ready');
        setOfflineProgress(message.ready ? 100 : 0);
        setOfflineMessage(message.ready ? 'Aplicativo, mapa 3D e motor disponíveis sem internet.' : 'O pacote offline ainda não foi preparado.');
      }
      if (message?.type === 'OFFLINE_PROGRESS') {
        setOfflineState('preparing');
        setOfflineProgress(Math.round((Number(message.completed) / Number(message.total)) * 100));
        setOfflineMessage(message.message);
      }
      if (message?.type === 'OFFLINE_READY') {
        setOfflineState('ready');
        setOfflineProgress(100);
        setOfflineMessage('Aplicativo, mapa 3D e motor disponíveis sem internet.');
      }
      if (message?.type === 'OFFLINE_ERROR') {
        setOfflineState('error');
        setOfflineMessage(`Não foi possível concluir: ${message.message}`);
      }
    };
    const onServiceWorkerControllerChange = () => {
      if (!controlledAtStartup || reloadingForUpdate || disposed) return;
      reloadingForUpdate = true;
      window.location.reload();
    };
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
    navigator.serviceWorker?.addEventListener('controllerchange', onServiceWorkerControllerChange);

    async function initializeApplication() {
      if (!nativeRuntime && 'serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          await registration.update();
          const readyRegistration = await navigator.serviceWorker.ready;
          if (disposed) return;
          serviceWorkerRef.current = readyRegistration;
          (readyRegistration.active ?? registration.active)?.postMessage({ type: 'CHECK_OFFLINE_STATUS' });
        } catch (registrationError) {
          setOfflineState('error');
          setOfflineMessage(`Cache offline indisponível: ${registrationError instanceof Error ? registrationError.message : String(registrationError)}`);
        }
      } else if (!nativeRuntime) {
        setOfflineState('unsupported');
        setOfflineMessage('Este navegador não oferece armazenamento offline.');
      }

      if (disposed) return;
      worker = new Worker('/simulation/worker.js', { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event) => {
        const message = event.data;
        if (message.type === 'status') {
          setStatus(message.message);
          setProgress(message.progress ?? 0);
        }
        if (message.type === 'ready') {
          setEngineState('ready');
          setStatus('Motor de cálculo pronto.');
          setProgress(100);
        }
        if (message.type === 'result') {
          const nextResult = message.result as SimulationResult;
          const resultVehicle = nextResult.vehicle;
          setResult(nextResult);
          setEngineState('ready');
          setStatus('Simulação concluída.');
          setProgress(100);
          setError(null);
          localStorage.setItem(
            `rocket:${resultVehicle}:last-result`,
            JSON.stringify({ ...message.result, detailed_plots: [] }),
          );
          localStorage.setItem(`rocket:${resultVehicle}:atmosphere`, JSON.stringify(message.result.atmosphere));
          setSavedAtmospheres((current) => ({ ...current, [resultVehicle]: true }));
        }
        if (message.type === 'error') {
          setEngineState('error');
          setStatus('A simulação não pôde ser concluída.');
          setError(message.message);
        }
      };
      worker.onerror = (event) => {
        setEngineState('error');
        setError(event.message || 'O motor de cálculo foi interrompido.');
      };
      worker.postMessage({ type: 'initialize' });
    }

    void initializeApplication();

    return () => {
      disposed = true;
      worker?.terminate();
      window.clearTimeout(atmosphereCheck);
      workerRef.current = null;
      serviceWorkerRef.current = null;
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
      navigator.serviceWorker?.removeEventListener('controllerchange', onServiceWorkerControllerChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [nativeRuntime]);

  const atmosphereLabel = useMemo(() => {
    if (!result?.atmosphere) return 'Ainda não carregada';
    if (result.atmosphere.source === 'open-meteo') return 'Open-Meteo';
    if (result.atmosphere.source === 'standard') return 'Atmosfera padrão · sem vento';
    return 'Última atmosfera salva';
  }, [result]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function chooseVehicle(nextVehicle: Vehicle) {
    const defaults = nextVehicle === 'atlas' ? ATLAS_FORM : DEIMOS_FORM;
    let nextForm = { ...defaults, launch_date: todayInSaoPaulo() };
    let nextResult: SimulationResult | null = null;
    const savedFormKey = nextVehicle === 'atlas'
      ? 'rocket:atlas:last-form:v2'
      : 'rocket:deimos:last-form';
    const savedResultKey = `rocket:${nextVehicle}:last-result`;

    try {
      const savedForm = localStorage.getItem(savedFormKey);
      if (savedForm) {
        nextForm = { ...defaults, ...JSON.parse(savedForm) };
        nextForm.atmosphere_mode = nextForm.atmosphere_mode === 'standard' ? 'standard' : 'forecast';
      }
    } catch { localStorage.removeItem(savedFormKey); }

    const plotPreferenceMigrationKey = `mari:plot-default-enabled:${nextVehicle}`;
    if (!localStorage.getItem(plotPreferenceMigrationKey)) {
      nextForm.verbose = 'true';
      localStorage.setItem(plotPreferenceMigrationKey, '1');
    }

    try {
      const savedResult = localStorage.getItem(savedResultKey);
      if (savedResult) {
        const parsed = JSON.parse(savedResult) as SimulationResult;
        if (parsed.schema_version === 7 && parsed.vehicle === nextVehicle) nextResult = parsed;
        else localStorage.removeItem(savedResultKey);
      }
    } catch { localStorage.removeItem(savedResultKey); }

    setVehicle(nextVehicle);
    setSelectedRocket(null);
    setForm(nextForm);
    setResult(nextResult);
    setError(null);
  }

  function changeVehicle() {
    setVehicle(null);
    setSelectedRocket(null);
    setResult(null);
    setError(null);
  }

  function openDownloadedRocket(rocket: InstalledRocket) {
    if (rocket.manifest.id === 'atlas') {
      chooseVehicle('atlas');
      return;
    }
    if (rocket.manifest.id === 'deimos-ii') {
      chooseVehicle('deimos');
      return;
    }
    const manifest = rocket.manifest;
    const nextForm: FormState = {
      ...DEIMOS_FORM,
      launch_date: todayInSaoPaulo(),
      latitude: String(manifest.ambiente.latitude),
      longitude: String(manifest.ambiente.longitude),
      rocket_mass_kg: String((manifest.foguete.massa_kg as number) ?? DEIMOS_FORM.rocket_mass_kg),
      flight_case: (manifest.casos_voo.includes('nominal') ? 'nominal' : manifest.casos_voo[0]) as FlightCase,
    };
    for (const field of manifest.campos_formulario) nextForm[field.id] = String(field.valor_inicial);
    setSelectedRocket(rocket);
    setVehicle(manifest.id);
    setForm(nextForm);
    setResult(null);
    setError(null);
  }

  async function prepareOffline() {
    if (nativeRuntime) {
      setOfflineState('ready');
      setOfflineProgress(100);
      setOfflineMessage('Motor e arquivos incorporados ao aplicativo.');
      return;
    }
    if (!online) {
      setOfflineState('error');
      setOfflineMessage('Conecte-se à internet uma vez para baixar o pacote offline.');
      return;
    }
    if (!('serviceWorker' in navigator)) {
      setOfflineState('unsupported');
      setOfflineMessage('Este navegador não oferece armazenamento offline.');
      return;
    }

    setOfflineState('preparing');
    setOfflineProgress(1);
    setOfflineMessage('Iniciando o armazenamento offline…');
    try {
      const registration = serviceWorkerRef.current ?? await navigator.serviceWorker.ready;
      serviceWorkerRef.current = registration;
      await navigator.storage?.persist?.();
      const runtimeAssets = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((asset) => asset.startsWith(window.location.origin));
      const activeWorker = registration.active ?? registration.waiting;
      if (!activeWorker) throw new Error('O serviço offline ainda está iniciando. Tente novamente em alguns segundos.');
      const mapCenters = [DEIMOS_FORM, ATLAS_FORM, form]
        .map((mapForm) => ({
          latitude: Number(mapForm.latitude),
          longitude: Number(mapForm.longitude),
        }))
        .filter((center, index, centers) =>
          Number.isFinite(center.latitude) &&
          Number.isFinite(center.longitude) &&
          centers.findIndex((candidate) =>
            Math.abs(candidate.latitude - center.latitude) < 0.0001 &&
            Math.abs(candidate.longitude - center.longitude) < 0.0001,
          ) === index,
        );
      activeWorker.postMessage({ type: 'PREPARE_OFFLINE', runtimeAssets, mapCenters });
    } catch (offlineError) {
      setOfflineState('error');
      setOfflineMessage(offlineError instanceof Error ? offlineError.message : String(offlineError));
    }
  }

  async function installRocketPackage(entry: RocketCatalogEntry) {
    if (!online) {
      setCatalogMessage('Conecte-se à internet para baixar ou atualizar este pacote. Os pacotes já baixados continuam offline.');
      return;
    }
    setDownloadingRocket(entry.id);
    setDownloadProgress(0);
    setCatalogMessage(`Baixando os dados de ${entry.nome}…`);
    try {
      const installed = await downloadRocketPackage(entry, (done, total) => {
        setDownloadProgress(Math.round((done / Math.max(total, 1)) * 100));
      });
      const latestInstalled = await getInstalledRockets();
      setInstalledRockets(latestInstalled);
      setCatalogMessage(`${installed.manifest.nome} ${installed.manifest.versao_dados} foi salvo neste aparelho para uso offline.`);
    } catch (downloadError) {
      setCatalogMessage(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setDownloadingRocket(null);
    }
  }

  function dismissCatalogNotice() {
    const updates = catalog?.foguetes.filter((entry) => {
      const installed = installedRockets.find((rocket) => rocket.manifest.id === entry.id);
      const bundledVersion = bundledCatalog?.foguetes.find((item) => item.id === entry.id)?.versao_dados;
      const currentVersion = installed?.manifest.versao_dados ?? bundledVersion;
      return !currentVersion || currentVersion !== entry.versao_dados;
    }) ?? [];
    const noticeVersion = updates.map((entry) => `${entry.id}@${entry.versao_dados}`).sort().join('|');
    localStorage.setItem('mari:catalog-notice-dismissed', noticeVersion);
    if (apkUpdate) localStorage.setItem('mari:apk-notice-dismissed', apkUpdate.versionName);
    setUpdateNoticeOpen(false);
  }

  async function downloadApkUpdate() {
    if (!apkUpdate) return;
    try {
      if (nativeRuntime) await ExternalLink.open({ url: apkUpdate.downloadUrl });
      else window.open(apkUpdate.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (openError) {
      setCatalogMessage(openError instanceof Error ? openError.message : 'Não foi possível abrir o download do APK.');
    }
  }

  function validate() {
    const mass = Number(form.rocket_mass_kg);
    const cg = Number(vehicle === 'atlas' ? form.cg_reference_m : form.cg_from_tail_m);
    const simulations = Number(form.number_of_simulations);
    const inclination = Number(form.inclination_deg);
    const rail = Number(form.rail_length_m);
    const heading = Number(form.heading_deg);
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (!(mass > 0)) return 'Informe uma massa positiva.';
    if (selectedRocket) {
      for (const field of selectedRocket.manifest.campos_formulario) {
        const value = Number(form[field.id]);
        if (!Number.isFinite(value)) return `Informe um valor válido para ${field.rotulo}.`;
        if (field.minimo !== undefined && value < field.minimo) return `${field.rotulo} deve ser pelo menos ${field.minimo} ${field.unidade}.`;
        if (field.maximo !== undefined && value > field.maximo) return `${field.rotulo} não pode exceder ${field.maximo} ${field.unidade}.`;
      }
    }
    if (vehicle === 'atlas' && !(cg >= 0 && cg <= 2.707)) return 'O CG deve estar entre 0 e 2,707 m desde o nariz.';
    if (vehicle === 'deimos' && !(cg >= 0 && cg <= 1.5)) return 'O CG deve estar entre 0 e 1,5 m desde a cauda.';
    if (!(latitude >= -90 && latitude <= 90)) return 'A latitude deve estar entre −90° e 90°.';
    if (!(longitude >= -180 && longitude <= 180)) return 'A longitude deve estar entre −180° e 180°.';
    if (vehicle === 'atlas' && !(Number(form.inertia_xx_kg_m2) > 0 && Number(form.inertia_zz_kg_m2) > 0)) return 'Informe inércias positivas para o Atlas.';
    if (vehicle === 'atlas' && !(Number(form.grain_density_kg_m3) > 0)) return 'Informe uma densidade de propelente positiva.';
    if (vehicle === 'atlas' && !(Number(form.grain_separation_m) >= 0)) return 'A separação entre grãos não pode ser negativa.';
    if (!Number.isInteger(simulations) || simulations < 1 || simulations > 100) return 'O número de simulações deve ser um inteiro entre 1 e 100.';
    if (!(inclination > 0 && inclination <= 90)) return 'A inclinação deve estar entre 0° e 90°.';
    if (!(rail > 0 && rail <= 20)) return 'O comprimento da rampa deve estar entre 0 e 20 m.';
    if (!(heading >= 0 && heading <= 360)) return 'O rumo deve estar entre 0° e 360°.';
    if (form.flight_case === 'custom' && !(Number(form.custom_altitude_m) > 0)) return 'Informe uma altitude positiva para o acionamento customizado.';
    return null;
  }

  async function simulate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicle) return;
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    if (!workerRef.current || engineState !== 'ready') return;
    setEngineState('running');
    setError(null);
    setStatus('Enviando parâmetros ao motor de cálculo…');
    setProgress(3);
    const cachedAtmosphere = localStorage.getItem(`rocket:${vehicle}:atmosphere`);
    localStorage.setItem(
      selectedRocket ? `rocket:${vehicle}:last-form` : vehicle === 'atlas' ? 'rocket:atlas:last-form:v2' : 'rocket:deimos:last-form',
      JSON.stringify(form),
    );
    let openMeteoResponse: Record<string, unknown> | null = null;
    let openMeteoFetchError: string | null = null;
    let packageFiles: Record<string, ArrayBuffer> | null = null;
    let rocketPackage: { manifest: InstalledRocket['manifest']; files: Record<string, ArrayBuffer> } | null = null;
    const transferables: ArrayBuffer[] = [];
    if (selectedRocket) {
      rocketPackage = { manifest: selectedRocket.manifest, files: {} };
      try {
        for (const key of ['motor', 'arrasto_ligado', 'arrasto_desligado']) {
          const bytes = await getPackageAsset(selectedRocket, key);
          rocketPackage.files[key] = bytes;
          transferables.push(bytes);
        }
      } catch (packageError) {
        setError(`Não foi possível ler os dados salvos de ${vehicle}: ${packageError instanceof Error ? packageError.message : String(packageError)}`);
        setEngineState('ready');
        return;
      }
    } else {
      const packageId = vehicle === 'atlas' ? 'atlas' : 'deimos-ii';
      try {
        const installedPackage = await getInstalledRocket(packageId);
        if (installedPackage) {
          const runtimeManifest = { ...installedPackage.manifest, id: vehicle };
          rocketPackage = { manifest: runtimeManifest, files: {} };
          for (const key of ['motor', 'arrasto_ligado', 'arrasto_desligado']) {
            const bytes = await getPackageAsset(installedPackage, key);
            rocketPackage.files[key] = bytes;
            transferables.push(bytes);
          }
        }
      } catch (packageError) {
        setError(`Não foi possível ler os dados salvos de ${packageId}: ${packageError instanceof Error ? packageError.message : String(packageError)}`);
        setEngineState('ready');
        return;
      }
    }
    if (form.atmosphere_mode === 'forecast' && online) {
      setStatus('Consultando a previsão atmosférica do Open-Meteo…');
      setProgress(8);
      try {
        const url = openMeteoForecastUrl(form);
        if (nativeRuntime) {
          const response = await CapacitorHttp.get({ url, responseType: 'json' });
          if (response.status >= 200 && response.status < 300) openMeteoResponse = response.data as Record<string, unknown>;
          else throw new Error(`Open-Meteo respondeu com HTTP ${response.status}.`);
        } else {
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) throw new Error(`Open-Meteo respondeu com HTTP ${response.status}.`);
          openMeteoResponse = await response.json() as Record<string, unknown>;
        }
      } catch (weatherError) {
        openMeteoFetchError = weatherError instanceof Error ? weatherError.message : String(weatherError);
        setStatus('Open-Meteo indisponível; tentando usar a última atmosfera salva…');
      }
    }
    workerRef.current.postMessage({
      type: 'simulate',
      params: {
        ...form,
        vehicle,
        native_runtime: nativeRuntime,
        atmosphere_fetch_error: openMeteoFetchError,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        rocket_mass_kg: Number(form.rocket_mass_kg),
        cg_from_tail_m: Number(form.cg_from_tail_m),
        cg_reference_m: Number(form.cg_reference_m),
        inertia_xx_kg_m2: Number(form.inertia_xx_kg_m2),
        inertia_zz_kg_m2: Number(form.inertia_zz_kg_m2),
        grain_density_kg_m3: Number(form.grain_density_kg_m3),
        grain_separation_m: Number(form.grain_separation_m),
        number_of_simulations: Number(form.number_of_simulations),
        inclination_deg: Number(form.inclination_deg),
        rail_length_m: Number(form.rail_length_m),
        heading_deg: Number(form.heading_deg),
        custom_altitude_m: Number(form.custom_altitude_m),
        verbose: form.verbose === 'true',
        animate_trajectory: form.animate_trajectory,
        ...(selectedRocket ? Object.fromEntries(selectedRocket.manifest.campos_formulario.map((field) => [field.id, Number(form[field.id])])) : {}),
      },
      cachedAtmosphere: cachedAtmosphere ? JSON.parse(cachedAtmosphere) : null,
      openMeteoResponse,
      packageFiles,
      rocketPackage,
    }, transferables);
  }

  async function exportKml() {
    if (!result?.kml_content) {
      setError('Execute uma nova simulação para gerar a trajetória KML.');
      return;
    }

    try {
      if (nativeRuntime) {
        await KmlExporter.open({
          content: result.kml_content,
          fileName: result.kml_file_name,
        });
      } else {
        const blob = new Blob([result.kml_content], {
          type: 'application/vnd.google-earth.kml+xml;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.kml_file_name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      setError(null);
    } catch (exportError) {
      setError(`Não foi possível exportar o KML: ${exportError instanceof Error ? exportError.message : String(exportError)}`);
    }
  }

  const running = engineState === 'running';
  const ready = engineState === 'ready';
  const trajectory = result?.deterministic.trajectory ?? [];
  const detailedPlotsRequested = result?.detailed_plots_requested ?? (form.verbose === 'true');

  if (!vehicle) {
    return (
      <main className={`min-h-screen bg-[#08090c] px-4 py-8 text-white sm:px-6 lg:grid lg:place-items-center lg:py-12 ${nativeRuntime ? 'native-safe-area-page' : ''}`}>
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-8 text-center sm:mb-10">
            <div className="mx-auto mb-5 flex w-fit items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.045] p-3 pr-5 text-left">
              <KosmosLogo />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Equipe</p>
                <p className="mt-1 font-heading text-lg font-semibold tracking-tight sm:text-xl">Kosmos Rocketry</p>
              </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">MARI</p>
            <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Módulo de Análise de Rotas e Impacto</h1>
            <h2 className="mt-7 font-heading text-xl font-semibold tracking-tight text-white/90 sm:text-2xl">Qual foguete será simulado?</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/60">Cada veículo mantém seus próprios parâmetros, atmosfera salva e últimos resultados neste aparelho.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <button type="button" onClick={() => chooseVehicle('atlas')} className="group min-h-64 rounded-3xl border border-[#48a7ff]/30 bg-[radial-gradient(circle_at_top_right,rgba(56,159,255,0.24),transparent_17rem),linear-gradient(145deg,#18212c,#303a46)] p-6 text-left shadow-2xl shadow-blue-950/30 transition hover:-translate-y-1 hover:border-[#67b7ff]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67b7ff] sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="grid size-12 place-items-center rounded-2xl bg-[#1687ed] text-white shadow-lg shadow-blue-950/40"><Rocket className="size-6" /></div>
              </div>
              <p className="mt-10 text-xs font-semibold uppercase tracking-[0.16em] text-blue-200/70">Atlas · Motor Proton</p>
              <h2 className="mt-1 font-heading text-3xl font-semibold">ATLAS</h2>
              <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-blue-100">Abrir console <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></div>
            </button>

            <button type="button" onClick={() => chooseVehicle('deimos')} className="group min-h-64 rounded-3xl border border-[#ff1493]/35 bg-[radial-gradient(circle_at_top_right,rgba(255,20,147,0.27),transparent_17rem),linear-gradient(145deg,#050306,#160a12)] p-6 text-left shadow-2xl shadow-pink-950/30 transition hover:-translate-y-1 hover:border-[#ff4caf]/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a9d] sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="grid size-12 place-items-center rounded-2xl bg-[#ff1493] text-black shadow-lg shadow-pink-950/40"><Rocket className="size-6" /></div>
              </div>
              <p className="mt-10 text-xs font-semibold uppercase tracking-[0.16em] text-pink-200/70">DEIMOS II · Motor BATES</p>
              <h2 className="mt-1 font-heading text-3xl font-semibold">DEIMOS II</h2>
              <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-pink-100">Abrir console <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></div>
            </button>
          </div>

          <section aria-label="Catálogo de foguetes" className="mt-5 rounded-2xl border border-white/10 bg-white/[0.045] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-heading text-lg font-semibold">Catálogo de foguetes</h2>
                <p className="mt-1 text-xs leading-5 text-white/55">{catalogMessage}</p>
              </div>
              <Badge variant="outline" className={catalogState === 'ready' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-white/10 text-white/55'}>
                {catalogState === 'checking' ? 'Consultando' : catalogState === 'ready' ? 'Sincronizado' : catalogState === 'offline' ? 'Offline' : 'Indisponível'}
              </Badge>
            </div>
            {catalog?.foguetes.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {catalog.foguetes.map((entry) => {
                const installed = installedRockets.find((rocket) => rocket.manifest.id === entry.id);
                const bundledVersion = bundledCatalog?.foguetes.find((item) => item.id === entry.id)?.versao_dados;
                const currentVersion = installed?.manifest.versao_dados ?? bundledVersion;
                const updateAvailable = currentVersion !== entry.versao_dados;
                const savedOffline = installed?.manifest.versao_dados === entry.versao_dados;
                const includedInApk = !installed && bundledVersion === entry.versao_dados;
                return <article key={entry.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{entry.nome}</p>
                    <p className="mt-1 text-xs text-white/50">Dados v{entry.versao_dados} · {savedOffline ? 'salvo offline' : includedInApk ? 'incluído no APK' : currentVersion ? `versão local ${currentVersion}` : 'novo pacote'}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {installed && !['atlas', 'deimos-ii'].includes(entry.id) ? <Button type="button" size="sm" variant="outline" onClick={() => openDownloadedRocket(installed)}>Abrir</Button> : null}
                    <Button type="button" size="sm" variant={updateAvailable ? 'default' : 'outline'} disabled={!updateAvailable || !online || downloadingRocket !== null} onClick={() => void installRocketPackage(entry)}>
                      {downloadingRocket === entry.id ? <Activity className="animate-pulse" /> : updateAvailable ? <Download /> : <CheckCircle2 />}
                      {downloadingRocket === entry.id ? `${downloadProgress}%` : updateAvailable ? 'Baixar' : 'Pronto offline'}
                    </Button>
                  </div>
                </article>;
              })}
            </div> : catalogState === 'checking' ? <p className="mt-4 text-sm text-white/50">Carregando os foguetes publicados…</p> : <p className="mt-4 text-sm text-white/50">O catálogo não está disponível e ainda não há uma cópia local.</p>}
            <p className="mt-3 text-[11px] leading-5 text-white/40">Os pacotes baixados ficam armazenados neste aparelho. A simulação de novos foguetes usa os componentes declarados no manifesto; formatos de componente fora do suporte do RocketPy da MARI precisam de uma atualização do APK.</p>
          </section>

          <Dialog open={updateNoticeOpen} onOpenChange={(open) => { if (!open) dismissCatalogNotice(); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Há dados de foguete disponíveis</DialogTitle>
                <DialogDescription>Escolha os pacotes que deseja baixar. Depois do download, os arquivos ficam disponíveis offline neste aparelho.</DialogDescription>
              </DialogHeader>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {(catalog?.foguetes ?? []).filter((entry) => {
                  const installed = installedRockets.find((rocket) => rocket.manifest.id === entry.id);
                  const bundledVersion = bundledCatalog?.foguetes.find((item) => item.id === entry.id)?.versao_dados;
                  return (installed?.manifest.versao_dados ?? bundledVersion) !== entry.versao_dados;
                }).map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0"><p className="truncate font-medium">{entry.nome}</p><p className="text-xs text-muted-foreground">Dados v{entry.versao_dados}</p></div>
                  <Button type="button" size="sm" disabled={!online || downloadingRocket !== null} onClick={() => void installRocketPackage(entry)}>{downloadingRocket === entry.id ? `${downloadProgress}%` : 'Baixar'}</Button>
                </div>)}
              </div>
              {apkUpdate ? <div className="rounded-xl border border-primary/20 bg-primary/[0.05] p-3">
                <p className="font-semibold">Nova versão do aplicativo: {apkUpdate.versionName}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">O Android vai confirmar a instalação depois do download.</p>
                <Button type="button" className="mt-3 w-full" onClick={() => void downloadApkUpdate()}><Download />Baixar APK</Button>
              </div> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={dismissCatalogNotice}>Agora não</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.045] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${offlineState === 'ready' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/[0.07] text-white/70'}`}><HardDrive className="size-5" /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">Modo offline</p>
                  <Badge variant="outline" className={offlineState === 'ready' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-white/10 text-white/55'}>{offlineState === 'ready' ? 'Pronto' : offlineState === 'preparing' ? `${offlineProgress}%` : 'Requer preparação'}</Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/55">{offlineMessage} {nativeRuntime ? 'O mapa offline será incorporado na atualização do APK.' : 'O primeiro preparo baixa aproximadamente 100 MB e inclui um recorte de 20 km do mapa.'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-white/10 text-white/50">DEIMOS: {savedAtmospheres.deimos ? 'atmosfera salva' : 'sem atmosfera salva'}</Badge>
                  <Badge variant="outline" className="border-white/10 text-white/50">Atlas: {savedAtmospheres.atlas ? 'atmosfera salva' : 'sem atmosfera salva'}</Badge>
                </div>
              </div>
            </div>
            <Button type="button" variant={offlineState === 'ready' ? 'outline' : 'default'} onClick={() => void prepareOffline()} disabled={nativeRuntime || offlineState === 'preparing' || offlineState === 'unsupported' || !online} className="mt-4 w-full shrink-0 sm:mt-0 sm:w-auto">
              {offlineState === 'preparing' ? <Activity className="animate-pulse" /> : offlineState === 'ready' ? <CheckCircle2 /> : <Download />}
              {nativeRuntime ? 'Incorporado ao APK' : offlineState === 'ready' ? 'Atualizar pacote' : offlineState === 'preparing' ? 'Preparando…' : 'Preparar offline'}
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-white/55">
            <Badge variant="outline" className="border-white/10 text-white/60">{ready ? <CheckCircle2 /> : <Activity className="animate-pulse" />}{ready ? 'Motor pronto' : 'Preparando motor'}</Badge>
            <Badge variant="outline" className="border-white/10 text-white/60">{online ? <Cloud /> : <CloudOff />}{online ? 'Online' : 'Sem sinal'}</Badge>
          </div>
          <DeveloperCredit className="mt-6 text-white/35" />
        </div>
      </main>
    );
  }

  return (
    <main data-vehicle={vehicle} className={`min-h-screen text-foreground ${vehicle === 'atlas' ? 'bg-[radial-gradient(circle_at_top_left,rgba(35,137,226,0.17),transparent_32rem),linear-gradient(180deg,#edf3f8_0%,#dce5ed_100%)]' : 'bg-[radial-gradient(circle_at_top_left,rgba(255,20,147,0.18),transparent_32rem),linear-gradient(180deg,#070609_0%,#110a0f_100%)]'} ${nativeRuntime ? 'native-safe-area-bottom' : ''}`}>
      <header className={`sticky top-0 z-30 border-b backdrop-blur-xl ${nativeRuntime ? 'native-safe-area-header' : ''} ${vehicle === 'atlas' ? 'border-white/70 bg-[#edf3f8]/90' : 'border-pink-400/15 bg-black/85'}`}>
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <KosmosLogo compact />
            <div className="min-w-0">
              <h1 className="truncate font-heading text-base font-semibold tracking-tight sm:text-lg">MARI · {vehicle === 'atlas' ? 'ATLAS' : selectedRocket?.manifest.nome ?? 'DEIMOS II'}</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">Kosmos Rocketry · Análise de Rotas e Impacto</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11 shrink-0" aria-label="Voltar para a seleção de foguete" title="Voltar para a seleção de foguete" onClick={changeVehicle}><ArrowLeft /> <span className="hidden sm:inline">Trocar veículo</span></Button>
            <Badge variant="outline" className={online ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : ''}>{online ? <Cloud /> : <CloudOff />}{online ? 'Online' : 'Sem sinal'}</Badge>
            <Badge variant="outline" className={ready ? 'hidden border-emerald-300 bg-emerald-50 text-emerald-800 sm:inline-flex' : 'hidden sm:inline-flex'}>{ready ? <CheckCircle2 /> : <Activity className="animate-pulse" />}{ready ? 'Motor pronto' : 'Preparando'}</Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(350px,430px)_minmax(0,1fr)] lg:px-8 lg:py-7">
        <section aria-label="Parâmetros de voo">
          <Card className="border-0 bg-white/88 shadow-[0_18px_60px_rgba(42,54,47,0.08)] ring-black/[0.06] lg:sticky lg:top-[84px]">
            <CardHeader className="border-b border-border/70 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg"><SlidersHorizontal className="size-4 text-primary" />Configuração do cenário</CardTitle>
              <CardDescription>{selectedRocket ? selectedRocket.manifest.descricao ?? selectedRocket.manifest.nome : vehicle === 'atlas' ? 'Atlas com motor Proton.' : 'DEIMOS II com motor FAÍSCA POWER.'}</CardDescription>
              <CardAction><Button type="button" variant="ghost" size="icon" onClick={() => { if (selectedRocket) openDownloadedRocket(selectedRocket); else setForm({ ...(vehicle === 'atlas' ? ATLAS_FORM : DEIMOS_FORM), launch_date: todayInSaoPaulo() }); setError(null); }} aria-label="Restaurar valores nominais"><RotateCcw /></Button></CardAction>
            </CardHeader>
            <CardContent>
              <form onSubmit={simulate} className="space-y-5">
                <fieldset className="space-y-3">
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">Lançamento</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="launch_date" label="Data"><Input id="launch_date" type="date" value={form.launch_date} onChange={(e) => updateField('launch_date', e.target.value)} className="h-10 bg-white" required /></Field>
                    <Field id="launch_time" label="Hora" unit="São Paulo"><Input id="launch_time" type="time" value={form.launch_time} onChange={(e) => updateField('launch_time', e.target.value)} className="h-10 bg-white" required /></Field>
                  </div>
                  {vehicle === 'atlas' || selectedRocket ? <div className="grid grid-cols-2 gap-3">
                    <Field id="latitude" label="Latitude" unit="graus"><Input id="latitude" type="number" inputMode="decimal" step="0.000001" min="-90" max="90" value={form.latitude} onChange={(e) => updateField('latitude', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                    <Field id="longitude" label="Longitude" unit="graus"><Input id="longitude" type="number" inputMode="decimal" step="0.000001" min="-180" max="180" value={form.longitude} onChange={(e) => updateField('longitude', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                  </div> : null}
                  <Field id="atmosphere_mode" label="Atmosfera"><NativeSelect id="atmosphere_mode" value={form.atmosphere_mode} onChange={(e) => updateField('atmosphere_mode', e.target.value as FormState['atmosphere_mode'])} className="w-full [&_select]:h-10 [&_select]:bg-white"><NativeSelectOption value="forecast">Previsão · Open-Meteo</NativeSelectOption><NativeSelectOption value="standard">Atmosfera padrão · sem vento</NativeSelectOption></NativeSelect></Field>
                </fieldset>

                {selectedRocket ? <fieldset className="space-y-3 border-t border-border/70 pt-4">
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">Parâmetros do foguete</legend>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedRocket.manifest.campos_formulario.map((field) => <Field key={field.id} id={field.id} label={field.rotulo} unit={field.unidade}>
                      <Input id={field.id} type="number" inputMode="decimal" step="any" min={field.minimo} max={field.maximo} value={String(form[field.id] ?? field.valor_inicial)} onChange={(event) => updateField(field.id as keyof FormState, event.target.value as never)} className="h-10 bg-white font-mono" required />
                    </Field>)}
                  </div>
                </fieldset> : <>
                <fieldset className="space-y-3 border-t border-border/70 pt-4">
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">{vehicle === 'atlas' ? 'Foguete sem motor · origem no nariz' : 'Foguete sem motor'}</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="rocket_mass_kg" label="Massa" unit="kg"><Input id="rocket_mass_kg" type="number" inputMode="decimal" step="0.001" min="0.1" value={form.rocket_mass_kg} onChange={(e) => updateField('rocket_mass_kg', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                    {vehicle === 'atlas' ? <Field id="cg_reference_m" label="CG desde o nariz" unit="m"><Input id="cg_reference_m" type="number" inputMode="decimal" step="0.001" min="0" max="2.707" value={form.cg_reference_m} onChange={(e) => updateField('cg_reference_m', e.target.value)} className="h-10 bg-white font-mono" required /></Field> : <Field id="cg_from_tail_m" label="CG desde a cauda" unit="m"><Input id="cg_from_tail_m" type="number" inputMode="decimal" step="0.001" min="0" max="1.5" value={form.cg_from_tail_m} onChange={(e) => updateField('cg_from_tail_m', e.target.value)} className="h-10 bg-white font-mono" required /></Field>}
                  </div>
                  {vehicle === 'atlas' ? <div className="grid grid-cols-2 gap-3">
                    <Field id="inertia_xx_kg_m2" label="Inércia Ixx = Iyy" unit="kg·m²"><Input id="inertia_xx_kg_m2" type="number" inputMode="decimal" step="0.001" min="0.001" value={form.inertia_xx_kg_m2} onChange={(e) => updateField('inertia_xx_kg_m2', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                    <Field id="inertia_zz_kg_m2" label="Inércia Izz" unit="kg·m²"><Input id="inertia_zz_kg_m2" type="number" inputMode="decimal" step="0.00001" min="0.00001" value={form.inertia_zz_kg_m2} onChange={(e) => updateField('inertia_zz_kg_m2', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                  </div> : null}
                </fieldset>

                {vehicle === 'atlas' ? <fieldset className="space-y-3 border-t border-border/70 pt-4">
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">Motor Proton</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="grain_density_kg_m3" label="Densidade do grão" unit="kg/m³"><Input id="grain_density_kg_m3" type="number" inputMode="decimal" step="0.001" min="1" value={form.grain_density_kg_m3} onChange={(e) => updateField('grain_density_kg_m3', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                    <Field id="grain_separation_m" label="Separação dos grãos" unit="m"><Input id="grain_separation_m" type="number" inputMode="decimal" step="0.001" min="0" value={form.grain_separation_m} onChange={(e) => updateField('grain_separation_m', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                  </div>
                </fieldset> : null}
                </>}

                <fieldset className="space-y-3 border-t border-border/70 pt-4">
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">Rampa</legend>
                  <div className="grid grid-cols-3 gap-3">
                    <Field id="inclination_deg" label="Inclinação" unit="graus"><Input id="inclination_deg" type="number" inputMode="decimal" step="0.1" min="1" max="90" value={form.inclination_deg} onChange={(e) => updateField('inclination_deg', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                    <Field id="rail_length_m" label="Comprimento" unit="m"><Input id="rail_length_m" type="number" inputMode="decimal" step="0.1" min="0.1" value={form.rail_length_m} onChange={(e) => updateField('rail_length_m', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                    <Field id="heading_deg" label="Rumo" unit="graus"><Input id="heading_deg" type="number" inputMode="decimal" step="1" min="0" max="360" value={form.heading_deg} onChange={(e) => updateField('heading_deg', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                  </div>
                </fieldset>

                <fieldset className="space-y-3 border-t border-border/70 pt-4">
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">Recuperação e análise</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="flight_case" label="Flight case"><NativeSelect id="flight_case" value={form.flight_case} onChange={(e) => updateField('flight_case', e.target.value as FlightCase)} className="w-full [&_select]:h-10 [&_select]:bg-white">{(selectedRocket?.manifest.casos_voo ?? ['nominal', 'ballistic', 'main_apogee', ...(vehicle === 'atlas' ? ['drogue_only'] : ['custom'])]).map((flightCase) => <NativeSelectOption key={flightCase} value={flightCase}>{flightCase === 'nominal' ? 'Nominal' : flightCase === 'ballistic' ? 'Balístico' : flightCase === 'main_apogee' ? 'Main no apogeu' : flightCase === 'drogue_only' ? 'Somente drogue' : flightCase === 'custom' ? 'Customizado' : flightCase}</NativeSelectOption>)}</NativeSelect></Field>
                    <Field id="number_of_simulations" label="Simulações" unit="1–100"><Input id="number_of_simulations" type="number" inputMode="numeric" step="1" min="1" max="100" value={form.number_of_simulations} onChange={(e) => updateField('number_of_simulations', e.target.value)} className="h-10 bg-white font-mono" required /></Field>
                  </div>
                  {form.flight_case === 'custom' ? <Field id="custom_altitude_m" label="Altitude de acionamento" unit="m AGL"><Input id="custom_altitude_m" type="number" inputMode="decimal" step="1" min="1" value={form.custom_altitude_m} onChange={(e) => updateField('custom_altitude_m', e.target.value)} className="h-10 bg-white font-mono" required /></Field> : null}
                  <Field id="verbose" label="Gerar gráficos?"><NativeSelect id="verbose" value={form.verbose} onChange={(e) => updateField('verbose', e.target.value as Verbose)} className="w-full [&_select]:h-10 [&_select]:bg-white"><NativeSelectOption value="false">Não</NativeSelectOption><NativeSelectOption value="true">Sim</NativeSelectOption></NativeSelect></Field>
                  {form.verbose === 'true' ? <p className="text-xs leading-5 text-muted-foreground">Gera as figuras detalhadas do RocketPy. Essa etapa usa mais memória e pode levar alguns segundos extras.</p> : null}
                  <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                    <Checkbox
                      id="animate_trajectory"
                      checked={form.animate_trajectory}
                      onCheckedChange={(checked) => updateField('animate_trajectory', checked === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <Label htmlFor="animate_trajectory" className="cursor-pointer text-sm font-medium">Animar o foguete no mapa 3D</Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Calcula a atitude do {vehicle === 'atlas' ? 'Atlas' : 'DEIMOS II'} ao longo do voo e libera reprodução, recuperação e controle manual do tempo.
                      </p>
                    </div>
                  </div>
                </fieldset>

                {error ? <Alert variant="destructive"><AlertTriangle /><AlertTitle>Verifique a configuração</AlertTitle><AlertDescription className="break-words">{error}</AlertDescription></Alert> : null}
                <Button type="submit" size="lg" className="h-12 w-full rounded-xl text-base shadow-[0_10px_28px_rgba(25,80,63,0.22)]" disabled={!ready || running}>{running ? <Activity className="animate-pulse" /> : <Play />}{running ? 'Simulando…' : ready ? 'Simular no celular' : 'Preparando motor…'}</Button>
              </form>
            </CardContent>
          </Card>
        </section>

        <section aria-label="Resultados" className="min-w-0 space-y-5">
          <Card className={`border-0 text-white ring-white/10 ${vehicle === 'atlas' ? 'bg-[#1c354b] shadow-[0_18px_60px_rgba(20,54,84,0.2)]' : 'bg-[#120810] shadow-[0_18px_60px_rgba(255,20,147,0.13)] ring-pink-400/15'}`}>
            <CardContent className="py-0">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-white/10">{ready ? <CheckCircle2 className="size-5 text-emerald-300" /> : <Activity className="size-5 animate-pulse text-emerald-300" />}</div><div><p className="font-medium">{status}</p><p className="mt-0.5 text-xs text-white/60">O primeiro carregamento pode levar alguns instantes.</p></div></div>
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-white/20 text-white"><Wind /> {atmosphereLabel}</Badge>{result?.atmosphere.source === 'open-meteo' ? <a className="text-xs text-white/70 underline underline-offset-2" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Dados por Open-Meteo</a> : null}</div>
              </div>
              {!ready || running ? <Progress value={progress} className="mt-4 text-white"><ProgressLabel className="text-xs text-white/70">Progresso</ProgressLabel><ProgressValue className="text-xs text-white/70" /></Progress> : null}
            </CardContent>
          </Card>

          {result ? (
            <>
              {result.atmosphere_warning ? <Alert className="border-amber-300 bg-amber-50"><CloudOff /><AlertTitle>Atmosfera salva utilizada</AlertTitle><AlertDescription>{result.atmosphere_warning}</AlertDescription></Alert> : null}
              <Card className="border-0 bg-white/88 shadow-[0_18px_60px_rgba(42,54,47,0.08)] ring-black/[0.06]">
                <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Activity className="size-4 text-primary" />Resultado determinístico</CardTitle><CardDescription>{form.flight_case === 'ballistic' ? 'Voo sem acionamento de paraquedas.' : 'Voo com sistema de recuperação configurado.'}</CardDescription><CardAction><Badge className="bg-emerald-100 text-emerald-900">Concluído</Badge></CardAction></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                    <Metric icon={ArrowUpRight} label="Apogeu AGL" value={formatNumber(result.deterministic.apogee_agl_m, ' m')} emphasis />
                    <Metric icon={Gauge} label="Velocidade máxima" value={formatNumber(result.deterministic.max_speed_m_s, ' m/s')} emphasis />
                    <Metric icon={Activity} label="Mach máximo" value={formatNumber(result.deterministic.max_mach)} />
                    <Metric icon={Ruler} label="Saída da rampa" value={formatNumber(result.deterministic.out_of_rail_velocity_m_s, ' m/s')} />
                    <Metric icon={Rocket} label="Estabilidade inicial" value={formatNumber(result.deterministic.initial_stability_cal, ' cal')} />
                    <Metric icon={Timer} label="Tempo de voo" value={formatNumber(result.deterministic.flight_time_s, ' s')} />
                    <Metric icon={MapPinned} label="Deslocamento" value={formatNumber(result.deterministic.impact_distance_m, ' m')} />
                    <Metric icon={Gauge} label="Impacto vertical" value={formatNumber(result.deterministic.impact_velocity_m_s, ' m/s')} />
                  </div>
                  {form.verbose === 'true' ? <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"><Metric icon={ArrowUpRight} label="Apogeu ASL" value={formatNumber(result.deterministic.apogee_asl_m, ' m')} /><Metric icon={Timer} label="Tempo até apogeu" value={formatNumber(result.deterministic.apogee_time_s, ' s')} /><Metric icon={Activity} label="Aceleração máxima" value={formatNumber(result.deterministic.max_acceleration_m_s2, ' m/s²')} /><Metric icon={Activity} label="Aceleração na queima" value={formatNumber(result.deterministic.max_burn_acceleration_m_s2, ' m/s²')} /><Metric icon={Rocket} label="Estabilidade na saída" value={formatNumber(result.deterministic.out_of_rail_stability_cal, ' cal')} /><Metric icon={MapPinned} label="Impacto X" value={formatNumber(result.deterministic.impact_x_m, ' m')} /><Metric icon={MapPinned} label="Impacto Y" value={formatNumber(result.deterministic.impact_y_m, ' m')} /></div> : null}
                </CardContent>
              </Card>

              <Card className="border-0 bg-white/88 shadow-[0_18px_60px_rgba(42,54,47,0.08)] ring-black/[0.06]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><MapPinned className="size-4 text-primary" />Trajetória no mapa 3D</CardTitle>
                  <CardDescription>Imagem Sentinel-2 em cores naturais sobre o relevo real, com lançamento, apogeu, impacto e projeção até o solo.</CardDescription>
                  <CardAction><Badge variant="secondary">Satélite + relevo</Badge></CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  {result.kml_content ? (
                    <TrajectoryMap3D
                      kmlContent={result.kml_content}
                      vehicle={result.vehicle}
                      animationTrajectory={result.animation_trajectory}
                      parachuteDeploymentTime={result.deterministic.parachute_event_time_s}
                      parachuteEvents={result.deterministic.parachute_events}
                      recoveryEnabled={form.flight_case !== 'ballistic'}
                    />
                  ) : (
                    <div className="grid min-h-[320px] place-items-center rounded-2xl border border-dashed border-border bg-muted/35 p-8 text-center">
                      <div>
                        <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><MapPinned className="size-5" /></div>
                        <p className="mt-4 font-medium">Execute uma nova simulação</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Resultados salvos antes desta atualização ainda não possuem a trajetória KML necessária para montar o mapa 3D.</p>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-6 text-muted-foreground">{online ? 'Com internet, o mapa carrega os blocos necessários em alta resolução. O pacote offline salva previamente um recorte de 20 km ao redor do local de lançamento.' : 'Usando o recorte de satélite e relevo salvo neste aparelho.'}</p>
                    <Button type="button" variant="outline" onClick={() => void exportKml()} className="shrink-0"><Download />{nativeRuntime ? 'Abrir KML' : 'Baixar KML'}</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 bg-white/88 shadow-[0_18px_60px_rgba(42,54,47,0.08)] ring-black/[0.06]">
                <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Wind className="size-4 text-primary" />Condições de vento</CardTitle><CardDescription>A direção indica de onde o vento vem; o rumo indica para onde ele sopra.</CardDescription><CardAction><Badge variant="secondary">Perfil AGL</Badge></CardAction></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Metric icon={Wind} label="Magnitude" value={formatNumber(result.deterministic.surface_wind_m_s, ' m/s')} emphasis />
                    <Metric icon={Gauge} label="Magnitude" value={formatNumber(result.deterministic.surface_wind_km_h, ' km/h')} />
                    <Metric icon={Navigation} label="Direção · vem de" value={formatBearing(result.deterministic.surface_wind_direction_deg)} />
                    <Metric icon={Navigation} label="Rumo · vai para" value={formatBearing(result.deterministic.surface_wind_heading_deg)} />
                  </div>
                  {result.deterministic.wind_profile?.length ? <div className="mt-4 overflow-hidden rounded-xl border border-border/70"><Table><TableHeader><TableRow className="bg-muted/60"><TableHead>Altitude AGL</TableHead><TableHead>Magnitude</TableHead><TableHead className="hidden sm:table-cell">km/h</TableHead><TableHead>Direção · vem de</TableHead><TableHead className="hidden md:table-cell">Rumo · vai para</TableHead></TableRow></TableHeader><TableBody>{result.deterministic.wind_profile.map((point) => <TableRow key={point.altitude_agl_m}><TableCell className="font-mono">{formatNumber(point.altitude_agl_m, ' m')}</TableCell><TableCell className="font-mono">{formatNumber(point.speed_m_s, ' m/s')}</TableCell><TableCell className="hidden font-mono sm:table-cell">{formatNumber(point.speed_km_h, ' km/h')}</TableCell><TableCell>{formatBearing(point.direction_deg)}</TableCell><TableCell className="hidden md:table-cell">{formatBearing(point.heading_deg)}</TableCell></TableRow>)}</TableBody></Table></div> : <div className="mt-4 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Execute uma nova simulação para gerar o perfil vertical do vento.</div>}
                </CardContent>
              </Card>

              <div className="grid gap-5 xl:grid-cols-2">
                <Card className="border-0 bg-white/88 shadow-[0_18px_60px_rgba(42,54,47,0.08)] ring-black/[0.06]">
                  <CardHeader><CardTitle>Perfil de voo</CardTitle><CardDescription>Altitude e velocidade ao longo do tempo.</CardDescription></CardHeader>
                  <CardContent><ChartContainer config={trajectoryConfig} className="h-[280px] w-full aspect-auto"><LineChart data={trajectory} margin={{ left: 4, right: 10, top: 8, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="time_s" tickLine={false} axisLine={false} tickMargin={8} unit=" s" /><YAxis yAxisId="altitude" tickLine={false} axisLine={false} width={52} unit=" m" /><YAxis yAxisId="speed" orientation="right" tickLine={false} axisLine={false} width={50} unit=" m/s" /><ChartTooltip content={<ChartTooltipContent />} /><Line yAxisId="altitude" type="monotone" dataKey="altitude_agl_m" stroke="var(--color-altitude_agl_m)" strokeWidth={2.5} dot={false} /><Line yAxisId="speed" type="monotone" dataKey="speed_m_s" stroke="var(--color-speed_m_s)" strokeWidth={2} dot={false} /></LineChart></ChartContainer></CardContent>
                </Card>

                <Card className="border-0 bg-white/88 shadow-[0_18px_60px_rgba(42,54,47,0.08)] ring-black/[0.06]">
                  <CardHeader><CardTitle>{result.monte_carlo ? 'Dispersão de impacto' : 'Monte Carlo não solicitado'}</CardTitle><CardDescription>{result.monte_carlo ? `${result.monte_carlo.count} simulações seriais no aparelho.` : 'Selecione mais de uma simulação para calcular a dispersão.'}</CardDescription></CardHeader>
                  <CardContent>
                    {result.monte_carlo ? <><ChartContainer config={impactConfig} className="h-[240px] w-full aspect-auto"><ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="x_m" name="Leste/Oeste" unit=" m" tickLine={false} /><YAxis type="number" dataKey="y_m" name="Norte/Sul" unit=" m" tickLine={false} width={56} /><ZAxis range={[50, 50]} /><ChartTooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltipContent />} /><Scatter name="Impacto" data={result.monte_carlo.impact_points} fill="var(--color-impact)" /></ScatterChart></ChartContainer><div className="mt-4 grid grid-cols-2 gap-3"><Metric icon={ArrowUpRight} label="Apogeu médio" value={formatNumber(result.monte_carlo.apogee_agl_m.mean, ' m')} /><Metric icon={Gauge} label="Impacto médio" value={formatNumber(result.monte_carlo.impact_velocity_m_s.mean, ' m/s')} /></div></> : <div className="grid min-h-[280px] place-items-center rounded-xl border border-dashed border-border bg-muted/35 p-8 text-center"><div><div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><MapPinned className="size-5" /></div><p className="font-medium">Pronto para análise estocástica</p><p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">Aumente “Simulações” para gerar a área de dispersão.</p></div></div>}
                  </CardContent>
                </Card>
              </div>

              <Card className="border-0 bg-white/88 shadow-[0_18px_60px_rgba(42,54,47,0.08)] ring-black/[0.06]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Images className="size-4 text-primary" />Gráficos completos do RocketPy</CardTitle>
                  <CardDescription>Figuras detalhadas do RocketPy, recalculadas para este cenário.</CardDescription>
                  <CardAction><Badge variant="secondary">{result.detailed_plots.length ? `${result.detailed_plots.length} figuras` : result.plot_warning ? 'Falha ao gerar' : detailedPlotsRequested ? 'Execute novamente' : 'Não solicitados'}</Badge></CardAction>
                </CardHeader>
                <CardContent>
                  {result.plot_warning ? <Alert className="mb-4 border-amber-300 bg-amber-50"><AlertTriangle /><AlertTitle>Gráficos indisponíveis</AlertTitle><AlertDescription>{result.plot_warning}</AlertDescription></Alert> : null}
                  {result.detailed_plots.length ? (
                    <Accordion multiple defaultValue={['atmosphere']} className="overflow-hidden rounded-xl border border-border/70">
                      {PLOT_GROUPS.map((group) => {
                        const plots = result.detailed_plots.filter((plot) => plot.category === group.id);
                        if (!plots.length) return null;
                        return (
                          <AccordionItem key={group.id} value={group.id} className="px-4">
                            <AccordionTrigger className="py-4 hover:no-underline">
                              <span className="min-w-0 pr-3">
                                <span className="block font-semibold text-foreground">{group.label}</span>
                                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{group.description}</span>
                              </span>
                              <Badge variant="outline" className="mr-3 shrink-0">{plots.length}</Badge>
                            </AccordionTrigger>
                            <AccordionContent className="pb-4">
                              <div className="grid gap-4 xl:grid-cols-2">
                                {plots.map((plot) => (
                                  <article key={plot.id} className="overflow-hidden rounded-xl border border-border/70 bg-background">
                                    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3.5 py-3">
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">{plot.id.replace('plot-', 'Figura ')}</p>
                                        <h3 className="mt-0.5 text-sm font-semibold text-foreground">{plot.title}</h3>
                                      </div>
                                      <ZoomIn className="size-4 shrink-0 text-muted-foreground" />
                                    </div>
                                    <a href={plot.image_data_url} target="_blank" rel="noreferrer" className="block bg-white p-2 no-underline">
                                      <DetailedPlotImage plot={plot} />
                                    </a>
                                  </article>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  ) : (
                    <div className="grid min-h-[210px] place-items-center rounded-xl border border-dashed border-border bg-muted/35 p-8 text-center">
                      <div className="max-w-md">
                        <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><Images className="size-5" /></div>
                        <p className="font-medium">{result.plot_warning ? 'A simulação foi concluída sem as figuras' : detailedPlotsRequested ? 'Execute novamente para exibir os gráficos' : 'Geração de gráficos desativada'}</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{result.plot_warning ? 'Você ainda pode consultar os resultados numéricos. Tente gerar novamente as figuras em outra simulação.' : detailedPlotsRequested ? 'As figuras detalhadas não são mantidas no histórico local para economizar espaço. Execute novamente para vê-las.' : 'Ative “Gerar gráficos?” e execute novamente para gerar as figuras detalhadas do RocketPy.'}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="min-h-[520px] border-0 bg-white/75 shadow-[0_18px_60px_rgba(42,54,47,0.08)] ring-black/[0.06]">
              <CardContent className="grid flex-1 place-items-center py-14 text-center"><div className="max-w-md"><div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary"><Rocket className="size-8" /></div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Pronto para configurar</p><h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight">Novo cenário de voo</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Informe as medições realizadas em campo. O cálculo será executado neste aparelho e os resultados ficarão salvos localmente.</p><div className="mt-6 flex flex-wrap justify-center gap-2"><Badge variant="secondary">Motor {vehicle === 'atlas' ? 'Proton' : 'BATES'}</Badge><Badge variant="secondary">Arrasto {vehicle === 'atlas' ? 'OpenRocket' : 'RASAero'}</Badge><Badge variant="secondary">Base {vehicle === 'atlas' ? '488' : '493'} m ASL</Badge></div></div></CardContent>
            </Card>
          )}
        </section>
      </div>
      <footer className="mx-auto max-w-[1500px] px-4 pb-6 sm:px-6 lg:px-8">
        <DeveloperCredit className="text-muted-foreground/70" />
      </footer>
    </main>
  );
}
