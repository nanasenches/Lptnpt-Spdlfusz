import importlib
import ipywidgets as widgets
from IPython.display import display
import modular_code_edition as mce

importlib.reload(mce)

# -----------------------------------------------------------------------------
# Padroes extraidos diretamente do modular_code_edition.py
# -----------------------------------------------------------------------------

PADROES = {
    'data_hora':    "2026-06-23 12:00:00",
    'latitude':     -21.9419,
    'longitude':    -48.9531,
    'timezone':     "America/Sao_Paulo",
    'densidade':    1750.00622798,
    'sep_graos':    12 / 1000,
    'massa':        14332 / 1000,
    'Ixx':          5.549,
    'Izz':          0.05654,
    'cm_sem_motor': 1294 / 1000,
    'tam_haste':    6.0,
    'inclinacao':   80.0,
    'direcao':      90.0,
}

# -----------------------------------------------------------------------------
# Helpers de layout
# -----------------------------------------------------------------------------

WS   = widgets.Layout(width='200px')
WL   = widgets.Layout(width='240px')
LBL  = widgets.Layout(width='95px')
STY  = {'description_width': 'initial'}   # permite descriptions de qualquer tamanho

def campo(widget, unidade=''):
    if unidade:
        return widgets.HBox([widget, widgets.Label(unidade, layout=LBL)],
                            layout=widgets.Layout(align_items='center'))
    return widget

def titulo(texto):
    return widgets.HTML(f"<div style='font-size:15px; font-weight:bold; color:black; margin-top:20px'>{texto}</div>")

# -----------------------------------------------------------------------------
# Widgets
# -----------------------------------------------------------------------------

w_data_hora  = widgets.Text(      value=PADROES['data_hora'],    description='Data_hora:',    style=STY, layout=WL)
w_latitude   = widgets.FloatText( value=PADROES['latitude'],     description='Latitude:',     style=STY, layout=WS)
w_longitude  = widgets.FloatText( value=PADROES['longitude'],    description='Longitude:',    style=STY, layout=WS)
w_timezone   = widgets.Text(      value=PADROES['timezone'],     description='Timezone:',     style=STY, layout=WS)
w_densidade  = widgets.FloatText( value=PADROES['densidade'],    description='Densidade:',    style=STY, layout=WS)
w_sep_graos  = widgets.FloatText( value=PADROES['sep_graos'],    description='Sep. grãos:',   style=STY, layout=WS)
w_massa      = widgets.FloatText( value=PADROES['massa'],        description='Massa:',        style=STY, layout=WS)
w_Ixx        = widgets.FloatText( value=PADROES['Ixx'],          description='Ixx:',          style=STY, layout=WS)
w_Izz        = widgets.FloatText( value=PADROES['Izz'],          description='Izz:',          style=STY, layout=WS)
w_cm         = widgets.FloatText( value=PADROES['cm_sem_motor'], description='CM_sem_motor:', style=STY, layout=WS)
w_haste      = widgets.FloatText( value=PADROES['tam_haste'],    description='Tam_haste:',    style=STY, layout=WS)
w_inclinacao = widgets.FloatText( value=PADROES['inclinacao'],   description='Inclinação:',   style=STY, layout=WS)
w_direcao    = widgets.FloatText( value=PADROES['direcao'],      description='Direção:',      style=STY, layout=WS)

botao = widgets.Button(description='Aplicar modificações', button_style='primary',
                       layout=widgets.Layout(width='210px', height='36px'))
reset = widgets.Button(description='Restaurar padrões',    button_style='warning',
                       layout=widgets.Layout(width='170px', height='36px'))
saida = widgets.Output()

# -----------------------------------------------------------------------------
# Logica dos botoes
# -----------------------------------------------------------------------------

def ao_clicar(_):
    saida.clear_output()
    kwargs = {}

    if w_data_hora.value  != PADROES['data_hora']:    kwargs['data_hora']             = w_data_hora.value
    if w_latitude.value   != PADROES['latitude']:     kwargs['latitude']              = w_latitude.value
    if w_longitude.value  != PADROES['longitude']:    kwargs['longitude']             = w_longitude.value
    if w_timezone.value   != PADROES['timezone']:     kwargs['timezone']              = w_timezone.value
    if w_densidade.value  != PADROES['densidade']:    kwargs['densidade']             = w_densidade.value
    if w_sep_graos.value  != PADROES['sep_graos']:    kwargs['separacao_entre_graos'] = w_sep_graos.value
    if w_massa.value      != PADROES['massa']:        kwargs['massa']                 = w_massa.value
    if w_Ixx.value        != PADROES['Ixx']:          kwargs['Ixx']                   = w_Ixx.value
    if w_Izz.value        != PADROES['Izz']:          kwargs['Izz']                   = w_Izz.value
    if w_cm.value         != PADROES['cm_sem_motor']: kwargs['cm_sem_motor']          = w_cm.value
    if w_haste.value      != PADROES['tam_haste']:    kwargs['tam_haste']             = w_haste.value
    if w_inclinacao.value != PADROES['inclinacao']:   kwargs['inclinacao']            = w_inclinacao.value
    if w_direcao.value    != PADROES['direcao']:      kwargs['direcao']               = w_direcao.value

    with saida:
        importlib.reload(mce)
        mce.modifica(**kwargs)

def ao_resetar(_):
    w_data_hora.value  = PADROES['data_hora']
    w_latitude.value   = PADROES['latitude']
    w_longitude.value  = PADROES['longitude']
    w_timezone.value   = PADROES['timezone']
    w_densidade.value  = PADROES['densidade']
    w_sep_graos.value  = PADROES['sep_graos']
    w_massa.value      = PADROES['massa']
    w_Ixx.value        = PADROES['Ixx']
    w_Izz.value        = PADROES['Izz']
    w_cm.value         = PADROES['cm_sem_motor']
    w_haste.value      = PADROES['tam_haste']
    w_inclinacao.value = PADROES['inclinacao']
    w_direcao.value    = PADROES['direcao']
    saida.clear_output()

botao.on_click(ao_clicar)
reset.on_click(ao_resetar)

# -----------------------------------------------------------------------------
# Layout
# -----------------------------------------------------------------------------

display(widgets.VBox([
    widgets.HTML("<h3 style='margin-bottom:4px'>Painel de Edição ⚙️</h3>"),

    titulo("Ambiente"),
    widgets.HBox([
        campo(w_data_hora, '.'),
        campo(w_latitude, '.'),
        campo(w_longitude, '.'),
        campo(w_timezone, '.'),
    ], layout=widgets.Layout(gap='12px', flex_wrap='wrap')),

    titulo("Motor"),
    widgets.HBox([
        campo(w_densidade, 'kg/m3'),
        campo(w_sep_graos, 'm'),
    ], layout=widgets.Layout(gap='12px')),

    titulo("Estrutura"),
    widgets.HBox([
        campo(w_massa, 'kg'),
        campo(w_Ixx,   'kg.m2'),
        campo(w_Izz,   'kg.m2'),
    ], layout=widgets.Layout(gap='12px')),
    widgets.HBox([
        campo(w_cm, 'm'),
    ], layout=widgets.Layout(gap='12px')),

    titulo("Lançamento"),
    widgets.HBox([
        campo(w_haste,      'm'),
        campo(w_inclinacao, 'graus'),
        campo(w_direcao,    'graus'),
    ], layout=widgets.Layout(gap='12px')),

    widgets.HBox([botao, reset], layout=widgets.Layout(margin='20px 0 0 0', gap='10px')),
    saida,
]))