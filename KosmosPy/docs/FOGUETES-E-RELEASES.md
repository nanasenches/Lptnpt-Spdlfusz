# Catálogo de foguetes e geração do APK

Este guia descreve o formato inicial para organizar dados de foguetes e os comandos para validar e criar uma release Android.

## O que esta etapa faz

- Mantém o catálogo oficial em `foguetes/catalogo.json` e um `manifest.json` por foguete. Antes da compilação, os dados são copiados para `public/foguetes/` para uso offline.
- Mantém curvas `.eng` e `.csv` dentro da pasta de cada foguete, com caminhos relativos ao manifesto.
- Cria uma pasta inicial copiando a configuração de outro veículo.
- Confere a estrutura dos manifestos, campos e arquivos declarados antes de criar uma release.
- Gera o APK assinado usando o script já existente, preservando o `applicationId` e a chave atual.
- Consulta o catálogo GitHub ao abrir o app, mostra um aviso para pacotes novos/atualizados e armazena os downloads no IndexedDB do aparelho.
- Fornece os arquivos de motor e arrasto baixados ao worker quando simula Atlas ou Deimos II.
- Consulta a release mais recente do repositório e mostra o link do APK quando encontra uma versão mais nova.
- Consulta a previsão horária do Open-Meteo para a data e o local escolhidos, convertendo temperatura, pressão, vento e alturas geopotenciais para o formato de atmosfera personalizada do RocketPy.

## Limite atual importante

O app baixa e conserva pacotes do catálogo no IndexedDB do WebView. Os dados permanecem no aparelho entre aberturas e atualizações do APK; depois de baixar um pacote, o catálogo e os arquivos de motor/arrasto podem ser usados sem internet. Atlas e Deimos II mantêm o formulário especializado da MARI. Outros pacotes baixados podem ser abertos e simulados pelo formulário gerado a partir do manifesto e pelo construtor RocketPy genérico.

O construtor genérico v1 suporta motores sólidos com os parâmetros do manifesto, curvas `.eng`, arrasto tabular CSV e os componentes `nose`, `trapezoidal_fins`, `tail` e `rail_buttons`, além dos casos de recuperação listados. Os campos editáveis aceitos são `rocket_mass_kg`, `cg_from_tail_m`, `cg_reference_m`, `inertia_xx_kg_m2`, `inertia_zz_kg_m2`, `grain_density_kg_m3` e `grain_separation_m`. Formatos de componente ou parâmetros fora desse conjunto exigem uma atualização do APK. Modelos GLB opcionais são baixados e preservados junto ao pacote; o mapa 3D ainda usa o modelo visual padrão do Deimos para foguetes que não tenham visual próprio configurado no mapa.

O APK atual contém RocketPy `1.13.0`; por isso o validador recusa manifestos que declarem outra versão. Alterar a versão do RocketPy requer atualizar e empacotar a biblioteca Pyodide no APK.

A geração das figuras detalhadas do RocketPy vem ativada por padrão no formulário e pode ser desligada em `Gerar gráficos?` para reduzir uso de memória e tempo de cálculo. As figuras aparecem ao concluir a simulação atual; elas são removidas do histórico salvo para manter o armazenamento local pequeno, então é preciso executar novamente para mostrá-las após reabrir um resultado.

## Previsão do tempo

O modo `Previsão · Open-Meteo` busca dados horários para o local, data e horário escolhidos. Para datas futuras usa o endpoint de previsão; para datas passadas usa o arquivo de previsões históricas. O perfil vertical é montado com variáveis de superfície e níveis de pressão, e entregue ao RocketPy como `custom_atmosphere`. Em uma falha de rede ou sem conexão, o app usa o último perfil atmosférico salvo para aquele foguete. Datas fora do período disponível pelo serviço também podem cair nesse cache. A interface atribui os dados ao Open-Meteo, conforme a licença CC BY 4.0.

Um manifesto válido confirma a estrutura e a presença dos arquivos, mas não confirma que as unidades, curvas de arrasto, curva de empuxo ou geometria sejam fisicamente corretas. Os cálculos devem ser conferidos por alguém responsável pelo modelo antes de usar os resultados.

## Estrutura

```text
foguetes/                         # catálogo publicado no GitHub
├── catalogo.json
├── atlas/
│   ├── manifest.json
│   ├── empuxo.eng
│   ├── arrasto_on.csv
│   └── arrasto_off.csv
└── deimos-ii/
    ├── manifest.json
    ├── empuxo.eng
    ├── arrasto_on.csv
    └── arrasto_off.csv
```

`catalogo.json` é o índice. Cada manifesto declara identificação e versão, local do lançamento, motor, geometria do foguete, recuperação, arquivos e campos específicos que devem aparecer no formulário. Arquivos 3D são opcionais. Caminhos no manifesto devem ser relativos à pasta daquele foguete. A pasta `public/foguetes/` é gerada a partir desta árvore antes de compilar o APK e não é o local para editar os dados.

Ao atualizar qualquer dado de uma pasta, aumente `versao_dados` em formato `MAJOR.MINOR.PATCH`. Depois sincronize e valide o índice:

```powershell
pnpm rocket:validate
```

Se adicionar uma pasta com `manifest.json`, execute `pnpm rocket:sync-catalog` para atualizar o índice oficial antes de validar.

## Criar a pasta para outro foguete

No terminal, a partir desta pasta do projeto:

```powershell
pnpm rocket:new -- titan "Titan" --from=atlas
```

O comando cria `foguetes/titan`, atualiza o catálogo e copia arquivos e parâmetros do Atlas. **Essa cópia é apenas um ponto de partida**: substitua massa, dimensões, motor, inércias, CG, recuperação, campos e arquivos pelas informações reais do novo veículo. Não use a cópia para simular antes de revisar esses dados.

Para usar o Deimos II como base, troque `--from=atlas` por `--from=deimos-ii`. Os IDs devem conter apenas letras minúsculas, números e hífens.

## Publicar os dados no GitHub

Depois de organizar e validar a pasta, envie as alterações de `foguetes/` para a raiz do repositório público. O catálogo é a fonte única; o script de build sincroniza os dados para `public/foguetes/`. Preserve os nomes e caminhos relativos. Quando alterar uma pasta existente, aumente sua versão no `manifest.json` e atualize a entrada correspondente em `catalogo.json`.

O app consulta o catálogo em `https://raw.githubusercontent.com/nanasenches/Lptnpt-Spdlfusz/main/foguetes/catalogo.json`. Portanto, mantenha os arquivos dentro de `foguetes/` na raiz do branch `main`. O workflow `validar-catalogo.yml` verifica os dados quando há alterações nessa pasta. O app usa o último catálogo salvo se estiver sem internet e deixa os pacotes baixados no IndexedDB do WebView para uso offline.

## Criar o APK de release

Requisitos: Node.js 22, pnpm, JDK 21 x64 (JDK completo, com `javac.exe`), Android Studio/SDK com a plataforma Android 36 instalada e a chave oficial instalada localmente conforme `LEIA-ME-PRIMEIRO.txt` e o guia de manutenção. O script procura o SDK em `ANDROID_HOME`, `ANDROID_SDK_ROOT` e nos diretórios padrão, e verifica Java e SDK antes de pedir as senhas ou alterar a versão do APK. A chave e as senhas não devem ser adicionadas ao GitHub.

Para gerar o APK sem trabalhar pelo terminal, clique duas vezes em `GERAR-NOVO-APK.bat`. Também é possível executar:

```powershell
./scripts/build-release-apk.ps1
```

O script pede as senhas sem gravá-las em arquivos, valida os manifestos, incrementa automaticamente o `versionCode` e a versão de patch (`1.5` para `1.5.1`, por exemplo), compila o APK assinado e grava o resultado em `output/`. Para preservar os números atuais intencionalmente, passe `-SkipVersionBump`; uma release instalada por cima da anterior normalmente precisa de `versionCode` maior.

Para a publicação automática, configure os secrets `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_STORE_PASSWORD`, `ANDROID_RELEASE_KEY_PASSWORD` e `ANDROID_RELEASE_KEY_ALIAS` no repositório. Atualize `versionName` e `versionCode` em `android/app/build.gradle`, crie uma tag no formato `vX.Y.Z` igual ao `versionName` e envie a tag. O workflow `.github/workflows/publicar-apk.yml` compila o APK com a chave oficial e anexa o asset à Release. Não envie a chave ou senhas como arquivos ou texto ao repositório.

O app consulta a release mais recente e apresenta um pop-up com o link quando a versão publicada é maior que a instalada. A instalação no telefone continua sendo confirmada pelo Android. Para uma publicação manual, anexe um APK `.apk` a uma Release; o app detecta qualquer asset com essa extensão.

