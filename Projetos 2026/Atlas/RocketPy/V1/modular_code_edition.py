
import datetime
import threading
from rocketpy import Environment, Flight, Rocket, SolidMotor


def modifica(
    # Ambiente
    data_hora=None,
    latitude=None,
    longitude=None,
    timezone=None,

    # Motor
    densidade=None,
    separacao_entre_graos=None,

    # Estrutura
    massa=None,
    Ixx=None,
    Iyy=None,
    cm_sem_motor=None,

    # Lançamento
    tam_haste=None,
    inclinacao=None,
    direcao=None,
):
    """Permite modificar parâmetros específicos do código RocketPy de forma curta e rápida"""

    global env, Proton, Atlas, flightStage  # Caso haja alguma mudança, o global modificará automaticamente
                                            # os objetos do RocketPy, sem necessidade de return.

    ambiente_modificado = any(p is not None for p in [data_hora, latitude, longitude, timezone])
    motor_modificado = any(p is not None for p in [densidade, separacao_entre_graos])
    estrutura_modificada = any(p is not None for p in [massa, Ixx, Iyy, cm_sem_motor])
    lancamento_modificado = any(p is not None for p in [tam_haste, inclinacao, direcao])

    algo_mudou = any([ambiente_modificado, motor_modificado, estrutura_modificada, lancamento_modificado])

    if not algo_mudou:
        print("\nNenhuma modificação foi feita\n")
        return

    # -------------------------------------------------------------------------

    if ambiente_modificado:

        env = Environment(
            latitude  = latitude  if latitude  is not None else -21.9419,
            longitude = longitude if longitude is not None else -48.9531,
            timezone  = timezone  if timezone  is not None else "America/Sao_Paulo",
            datum="WGS84"
        )

        DATETIME = datetime.datetime.fromisoformat(data_hora if data_hora is not None else "2026-06-23 12:00:00")
        env.set_date(DATETIME)

        resultado = {"sucesso": False, "erro": None}

        def download_gefs():
            try:
                env.set_atmospheric_model(type="Ensemble", file="GEFS")
                resultado["sucesso"] = True
            except Exception as e:
                resultado["erro"] = e

        thread = threading.Thread(target=download_gefs)
        thread.start()
        thread.join(timeout=120)

        if thread.is_alive():
            print("GEFS não retornou — usando ECMWF como backup")
            env.set_atmospheric_model(type="Windy", file="ECMWF")
        elif resultado["sucesso"]:
            print("GEFS carregado com sucesso")
        else:
            print(f"GEFS retornou com erro: {resultado['erro']} — usando ECMWF")
            env.set_atmospheric_model(type="Windy", file="ECMWF")

        env.set_topographic_profile(
            type="NASADEM_HGT",
            file="NASADEM_NC_s22w049.nc",
            dictionary="netCDF4",
            crs=None
        )
        elevation = env.get_elevation_from_topographic_profile(env.latitude, env.longitude)
        env.set_elevation(elevation)

    # -------------------------------------------------------------------------

    if motor_modificado:

        Proton = SolidMotor(
            thrust_source="Proton.eng",
            dry_mass=15.652,
            dry_inertia=(0.0238, 1.065, 1.065),
            nozzle_radius=36.03 / 1000,
            grain_number=6,
            grain_density= densidade if densidade is not None else 1750.00622798,
            grain_outer_radius=45 / 1000,
            grain_initial_inner_radius=19.05 / 1000,
            grain_initial_height=140 / 1000,
            grain_separation= separacao_entre_graos if separacao_entre_graos is not None else 12 / 1000,
            grains_center_of_mass_position=533.946 / 1000,
            center_of_dry_mass_position=533.946 / 1000,
            nozzle_position=0,
            throat_radius=13.5 / 1000,
            coordinate_system_orientation="nozzle_to_combustion_chamber",
        )

    # -------------------------------------------------------------------------

    if estrutura_modificada:

        Atlas = Rocket(
            radius=76 / 1000,
            mass= massa if massa is not None else 13896 / 1000,
            inertia= (Ixx if Ixx is not None else 12.66, Iyy if Iyy is not None else 0.0697, Ixx if Ixx is not None else 12.66),
            power_off_drag="Atlas_CD_Power-Off.csv",
            power_on_drag="Atlas_CD_Power-On.csv",
            center_of_mass_without_motor= cm_sem_motor if cm_sem_motor is not None else 1268 / 1000,
            coordinate_system_orientation="nose_to_tail",
        )

        Atlas.add_nose(length=850 / 1000, kind="Von Karman", position=0)

        Atlas.add_trapezoidal_fins(
            n=4,
            root_chord=290 / 1000,
            tip_chord=50 / 1000,
            span=151.1 / 1000,
            position=2358 / 1000,
            cant_angle=0,
            sweep_length=230 / 1000,
        )

        Atlas.add_motor(Proton, position=2646 / 1000)

        Atlas.add_tail(
            top_radius=76 / 1000,
            bottom_radius=64.5 / 1000,
            length=300 / 1000,
            position=2348 / 1000,
            name="Boattail Cônico",
        )

        Atlas.set_rail_buttons(
            upper_button_position=1540 / 1000,
            lower_button_position=2320 / 1000,
            angular_position=45,
        )

    # -------------------------------------------------------------------------

    if lancamento_modificado or ambiente_modificado or motor_modificado or estrutura_modificada:

        flightStage = Flight(
            rocket=Atlas,
            environment=env,
            rail_length= tam_haste if tam_haste is not None else 6,
            inclination= inclinacao if inclinacao is not None else 80,
            heading= direcao if direcao is not None else 90,
        )

    # -------------------------------------------------------------------------

    print("\nModificações feitas com sucesso!\n")