'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Globe2,
  Focus,
  Maximize2,
  Mountain,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Satellite,
  WifiOff,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

type MapStatus =
  | { state: 'loading' }
  | { state: 'ready'; pointCount: number; offline: boolean }
  | { state: 'error'; message: string };

type AnimationPoint = {
  time_s: number;
  latitude_deg: number;
  longitude_deg: number;
  altitude_agl_m: number;
  e0: number;
  e1: number;
  e2: number;
  e3: number;
};

type TrajectoryMap3DProps = {
  kmlContent: string;
  vehicle: string;
  animationTrajectory?: AnimationPoint[] | null;
  parachuteDeploymentTime?: number | null;
  parachuteEvents?: Array<{
    name: string;
    kind: 'main' | 'drogue';
    trigger_time_s: number;
    deployment_time_s: number;
    diameter_m: number;
  }>;
  recoveryEnabled?: boolean;
};

type PlaybackState = {
  ready: boolean;
  currentTime: number;
  duration: number;
  playing: boolean;
};

const INITIAL_PLAYBACK: PlaybackState = {
  ready: false,
  currentTime: 0,
  duration: 0,
  playing: false,
};

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '0,0 s';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

export function TrajectoryMap3D({
  kmlContent,
  vehicle,
  animationTrajectory,
  parachuteDeploymentTime,
  parachuteEvents,
  recoveryEnabled = true,
}: TrajectoryMap3DProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [status, setStatus] = useState<MapStatus>({ state: 'loading' });
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL_PLAYBACK);
  const [cameraMode, setCameraMode] = useState<'overview' | 'rocket'>('overview');
  const hasAnimation = Boolean(animationTrajectory?.length);

  const postToMap = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  const sendTrajectory = useCallback(() => {
    postToMap({
      type: 'LOAD_TRAJECTORY_KML',
      kmlContent,
      vehicle,
      animationTrajectory: hasAnimation ? animationTrajectory : null,
      parachuteDeploymentTime,
      parachuteEvents,
      recoveryEnabled,
    });
  }, [animationTrajectory, hasAnimation, kmlContent, parachuteDeploymentTime, parachuteEvents, postToMap, recoveryEnabled, vehicle]);

  useEffect(() => {
    setPlayback(INITIAL_PLAYBACK);
    setCameraMode('overview');
  }, [animationTrajectory, kmlContent]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;

      const message = event.data;
      if (message?.type === 'TRAJECTORY_MAP_READY') sendTrajectory();
      if (message?.type === 'TRAJECTORY_MAP_RENDERED') {
        setStatus({
          state: 'ready',
          pointCount: Number(message.pointCount) || 0,
          offline: Boolean(message.offline),
        });
      }
      if (message?.type === 'TRAJECTORY_ANIMATION_READY') {
        setPlayback({
          ready: true,
          currentTime: Number(message.currentTime) || 0,
          duration: Number(message.duration) || 0,
          playing: Boolean(message.playing),
        });
      }
      if (message?.type === 'TRAJECTORY_ANIMATION_TICK') {
        setPlayback((current) => ({
          ...current,
          currentTime: Number(message.currentTime) || 0,
          playing: Boolean(message.playing),
        }));
      }
      if (message?.type === 'TRAJECTORY_MAP_ERROR') {
        setStatus({
          state: 'error',
          message: String(message.message || 'Não foi possível mostrar o mapa 3D.'),
        });
      }
    };

    window.addEventListener('message', onMessage);
    sendTrajectory();
    return () => window.removeEventListener('message', onMessage);
  }, [sendTrajectory]);

  async function openFullscreen() {
    if (!containerRef.current?.requestFullscreen) return;
    await containerRef.current.requestFullscreen();
  }

  function retry() {
    setStatus({ state: 'loading' });
    setPlayback(INITIAL_PLAYBACK);
    setFrameKey((current) => current + 1);
  }

  function setPlaying(playing: boolean) {
    setPlayback((current) => ({ ...current, playing }));
    postToMap({ type: 'SET_TRAJECTORY_ANIMATION_PLAYING', playing });
  }

  function setAnimationTime(value: number) {
    const time = Math.min(playback.duration, Math.max(0, value));
    setPlayback((current) => ({ ...current, currentTime: time, playing: false }));
    postToMap({ type: 'SET_TRAJECTORY_ANIMATION_TIME', time_s: time });
  }

  function resetAnimation() {
    setAnimationTime(0);
  }

  function toggleCameraMode() {
    const nextMode = cameraMode === 'rocket' ? 'overview' : 'rocket';
    setCameraMode(nextMode);
    postToMap({ type: 'SET_TRAJECTORY_CAMERA_MODE', mode: nextMode });
  }

  return (
    <div
      ref={containerRef}
      className="relative isolate overflow-hidden rounded-2xl border border-black/10 bg-[#05070a] shadow-inner fullscreen:h-screen fullscreen:w-screen fullscreen:rounded-none"
    >
      <iframe
        key={frameKey}
        ref={iframeRef}
        src="/trajectory-map.html"
        title="Mapa 3D interativo da trajetória do foguete"
        className="h-[430px] w-full border-0 sm:h-[520px]"
        onLoad={sendTrajectory}
        allow="fullscreen"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/75 via-black/25 to-transparent p-3 sm:p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge className="border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/55">
              <Globe2 className="size-3.5" />
              {status.state === 'ready'
                ? `${status.pointCount.toLocaleString('pt-BR')} pontos`
                : status.state === 'error'
                  ? 'Mapa indisponível'
                  : 'Carregando mapa'}
            </Badge>
            {status.state === 'ready' ? (
              <Badge className="border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/55">
                {status.offline ? <WifiOff className="size-3.5" /> : <Satellite className="size-3.5" />}
                {status.offline ? 'Recorte offline' : 'Satélite + relevo'}
              </Badge>
            ) : null}
            {status.state === 'ready' ? (
              <Badge className="hidden border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/55 sm:inline-flex">
                <Mountain className="size-3.5" /> Terreno real
              </Badge>
            ) : null}
            {playback.ready ? (
              <Badge className={vehicle === 'atlas'
                ? 'border-blue-300/30 bg-blue-500/80 text-white backdrop-blur-md hover:bg-blue-500/80'
                : 'border-pink-300/30 bg-pink-500/80 text-white backdrop-blur-md hover:bg-pink-500/80'}>
                <Play className="size-3.5" /> Animação 6-DOF
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 hidden max-w-sm text-xs leading-5 text-white/75 sm:block">
            {cameraMode === 'rocket'
              ? 'Câmera centrada no foguete. Arraste para orbitar e use a roda ou pinça para aproximar.'
              : 'Arraste para girar. Use a roda ou o gesto de pinça para aproximar.'}
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="pointer-events-auto shrink-0 border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/75"
          onClick={() => void openFullscreen()}
          aria-label="Abrir mapa em tela cheia"
          title="Tela cheia"
        >
          <Maximize2 />
        </Button>
      </div>

      {playback.ready ? (
        <div className="absolute inset-x-3 bottom-3 z-10 rounded-xl border border-white/15 bg-black/72 p-3 text-white shadow-2xl backdrop-blur-md sm:inset-x-4 sm:bottom-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              className="shrink-0 bg-white/12 text-white hover:bg-white/20"
              onClick={() => setPlaying(!playback.playing)}
              aria-label={playback.playing ? 'Pausar animação' : 'Reproduzir animação'}
            >
              {playback.playing ? <Pause /> : <Play />}
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="shrink-0 text-white hover:bg-white/12 hover:text-white"
              onClick={resetAnimation}
              aria-label="Voltar ao início da animação"
            >
              <RotateCcw />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={cameraMode === 'rocket' ? 'secondary' : 'ghost'}
              className="shrink-0 text-white hover:bg-white/12 hover:text-white"
              onClick={toggleCameraMode}
              aria-label={cameraMode === 'rocket' ? 'Voltar à visão da trajetória' : 'Acompanhar o foguete de perto'}
              title={cameraMode === 'rocket' ? 'Visão da trajetória' : 'Câmera próxima do foguete'}
            >
              <Focus />
            </Button>
            <Slider
              value={playback.currentTime}
              min={0}
              max={Math.max(playback.duration, 0.1)}
              step={0.05}
              onValueChange={(value) => setAnimationTime(Number(value))}
              aria-label="Tempo da animação"
              className="min-w-0 flex-1"
            />
            <span className="w-[88px] shrink-0 text-right font-mono text-[11px] text-white/80 sm:w-[112px] sm:text-xs">
              {formatTime(playback.currentTime)} / {formatTime(playback.duration)}
            </span>
          </div>
        </div>
      ) : null}

      {status.state === 'error' ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[#07090d]/95 p-6 text-center text-white">
          <div className="max-w-sm">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-white/10">
              <WifiOff className="size-5 text-amber-300" />
            </div>
            <p className="mt-4 font-semibold">Não foi possível carregar o mapa 3D</p>
            <p className="mt-2 text-sm leading-6 text-white/65">{status.message}</p>
            <Button type="button" variant="secondary" className="mt-4" onClick={retry}>
              <RefreshCcw /> Tentar novamente
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
