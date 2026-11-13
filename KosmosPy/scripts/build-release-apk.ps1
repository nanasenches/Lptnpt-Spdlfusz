param(
    [string]$KeystorePath = "",
    [string]$KeyAlias = "kosmos-mari-release",
    [switch]$SkipInstall,
    [switch]$SkipVersionBump
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

# Validate the Android toolchain before prompting for secrets or changing versions.
$javaPath = $null
if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    $javaPath = Join-Path $env:JAVA_HOME "bin\java.exe"
} else {
    $javaCommand = Get-Command java -ErrorAction SilentlyContinue
    if ($javaCommand) { $javaPath = $javaCommand.Source }
}
if (-not $javaPath -or -not (Test-Path -LiteralPath $javaPath -PathType Leaf)) {
    throw "JDK 21 x64 nao encontrado. Instale um JDK (nao apenas JRE), configure JAVA_HOME e abra um novo terminal."
}
$javacPath = Join-Path (Split-Path -Parent $javaPath) "javac.exe"
if (-not (Test-Path -LiteralPath $javacPath -PathType Leaf)) {
    throw "O Java encontrado nao e um JDK (javac.exe ausente): $javaPath. Instale o JDK 21 x64 e configure JAVA_HOME."
}
$javaStdoutPath = [System.IO.Path]::GetTempFileName()
$javaStderrPath = [System.IO.Path]::GetTempFileName()
try {
    $javaProcess = Start-Process -FilePath $javaPath `
        -ArgumentList @('-XshowSettings:properties', '-version') `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $javaStdoutPath `
        -RedirectStandardError $javaStderrPath
    $javaDetails = (Get-Content -LiteralPath $javaStdoutPath -Raw) + (Get-Content -LiteralPath $javaStderrPath -Raw)
} finally {
    Remove-Item -LiteralPath $javaStdoutPath, $javaStderrPath -Force -ErrorAction SilentlyContinue
}
if ($javaProcess.ExitCode -ne 0) {
    throw "Nao foi possivel iniciar o Java configurado em $javaPath. Configure JAVA_HOME para o JDK 21 x64."
}
$javaMajorMatch = [regex]::Match($javaDetails, '(?m)^\s*java\.specification\.version\s*=\s*(\d+)')
$javaArchMatch = [regex]::Match($javaDetails, '(?m)^\s*sun\.arch\.data\.model\s*=\s*(\d+)')
if (-not $javaMajorMatch.Success -or [int]$javaMajorMatch.Groups[1].Value -lt 21 -or
    -not $javaArchMatch.Success -or $javaArchMatch.Groups[1].Value -ne "64") {
    throw "O Gradle requer JDK 21 ou superior de 64 bits. Java detectado em $javaPath. Configure JAVA_HOME para um JDK 21 x64."
}

$sdkCandidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
    "C:\Android\Sdk"
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$sdkPath = $sdkCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -First 1
if (-not $sdkPath) {
    throw "Android SDK nao encontrado. Instale o Android Studio e o Android SDK Platform 36, ou defina ANDROID_HOME para a pasta do SDK."
}
if (-not (Test-Path -LiteralPath (Join-Path $sdkPath "platforms\android-36") -PathType Container)) {
    throw "SDK encontrado em '$sdkPath', mas falta a plataforma Android 36. Instale 'Android SDK Platform 36' no SDK Manager do Android Studio."
}
$env:ANDROID_HOME = $sdkPath
$env:ANDROID_SDK_ROOT = $sdkPath

if ([string]::IsNullOrWhiteSpace($KeystorePath)) {
    $KeystorePath = Join-Path $projectRoot "android\signing\kosmos-mari-release.jks"
}
$KeystorePath = [System.IO.Path]::GetFullPath($KeystorePath)

if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
    throw "Chave nao encontrada em: $KeystorePath"
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm nao encontrado. Instale o Node.js 22 e habilite o pnpm antes de continuar."
}

function Convert-ToPlainText([Security.SecureString]$SecureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$storePasswordSecure = Read-Host "Senha do arquivo de assinatura" -AsSecureString
$keyPasswordSecure = Read-Host "Senha da chave $KeyAlias" -AsSecureString
$storePassword = Convert-ToPlainText $storePasswordSecure
$keyPassword = Convert-ToPlainText $keyPasswordSecure

$previousEnvironment = @{
    MARI_KEYSTORE_PATH = $env:MARI_KEYSTORE_PATH
    MARI_KEYSTORE_PASSWORD = $env:MARI_KEYSTORE_PASSWORD
    MARI_KEY_ALIAS = $env:MARI_KEY_ALIAS
    MARI_KEY_PASSWORD = $env:MARI_KEY_PASSWORD
}
$versionBackup = $null
$buildSucceeded = $false

try {
    $env:MARI_KEYSTORE_PATH = $KeystorePath
    $env:MARI_KEYSTORE_PASSWORD = $storePassword
    $env:MARI_KEY_ALIAS = $KeyAlias
    $env:MARI_KEY_PASSWORD = $keyPassword

    Push-Location $projectRoot
    try {
        & node scripts/validate-rocket-catalog.mjs
        if ($LASTEXITCODE -ne 0) { throw "O catalogo de foguetes tem erros. Corrija-os antes de gerar a release." }

        if (-not $SkipVersionBump) {
            $gradleFile = Join-Path $projectRoot "android\app\build.gradle"
            $gradleText = Get-Content -LiteralPath $gradleFile -Raw
            $versionFile = Join-Path $projectRoot "public\app-version.json"
            $versionFileExisted = Test-Path -LiteralPath $versionFile -PathType Leaf
            $versionFileText = if ($versionFileExisted) { Get-Content -LiteralPath $versionFile -Raw } else { $null }
            $versionBackup = @{
                gradleFile = $gradleFile
                gradleText = $gradleText
                versionFile = $versionFile
                versionFileExisted = $versionFileExisted
                versionFileText = $versionFileText
            }
            $codeMatch = [regex]::Match($gradleText, '(?m)^\s*versionCode\s+(\d+)\s*$')
            $nameMatch = [regex]::Match($gradleText, '(?m)^\s*versionName\s+"(\d+)\.(\d+)(?:\.(\d+))?"\s*$')
            if (-not $codeMatch.Success -or -not $nameMatch.Success) {
                throw "Nao foi possivel identificar versionCode ou versionName no build.gradle. Use versao MAJOR.MINOR.PATCH."
            }
            $nextCode = [int]$codeMatch.Groups[1].Value + 1
            $major = [int]$nameMatch.Groups[1].Value
            $minor = [int]$nameMatch.Groups[2].Value
            $patch = if ($nameMatch.Groups[3].Success) { [int]$nameMatch.Groups[3].Value + 1 } else { 1 }
            $nextName = "$major.$minor.$patch"
            $gradleText = ([regex]::new('(?m)(^\s*versionCode\s+)\d+(\s*$)')).Replace($gradleText, "`${1}$nextCode`${2}", 1)
            $gradleText = ([regex]::new('(?m)(^\s*versionName\s+")\d+\.\d+(?:\.\d+)?("\s*$)')).Replace($gradleText, "`${1}$nextName`${2}", 1)
            [System.IO.File]::WriteAllText($gradleFile, $gradleText, [System.Text.UTF8Encoding]::new($false))
            $versionJson = @{ versionName = $nextName; versionCode = $nextCode } | ConvertTo-Json
            [System.IO.File]::WriteAllText($versionFile, $versionJson, [System.Text.UTF8Encoding]::new($false))
            Write-Host "Versao da release: $nextName (versionCode $nextCode)"
        }

        if (-not $SkipInstall) {
            & pnpm install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar as dependencias." }
        }

        & pnpm android:release
        if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o APK release." }

        $sourceApk = Join-Path $projectRoot "android\app\build\outputs\apk\release\app-release.apk"
        if (-not (Test-Path -LiteralPath $sourceApk)) {
            throw "O Gradle terminou, mas o APK esperado nao foi encontrado."
        }

        $outputDirectory = Join-Path $projectRoot "output"
        New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
        $versionNameMatch = [regex]::Match((Get-Content -LiteralPath (Join-Path $projectRoot "android\app\build.gradle") -Raw), '(?m)^\s*versionName\s+"([^"]+)"\s*$')
        $releaseVersion = if ($versionNameMatch.Success) { $versionNameMatch.Groups[1].Value } else { "release" }
        $destinationApk = Join-Path $outputDirectory "KosmosPy-$releaseVersion-release.apk"
        Copy-Item -LiteralPath $sourceApk -Destination $destinationApk -Force
        Write-Host "APK oficial gerado em: $destinationApk"
        $buildSucceeded = $true
    }
    finally {
        Pop-Location
    }
}
finally {
    if (-not $buildSucceeded -and $null -ne $versionBackup) {
        [System.IO.File]::WriteAllText($versionBackup.gradleFile, $versionBackup.gradleText, [System.Text.UTF8Encoding]::new($false))
        if ($versionBackup.versionFileExisted) {
            [System.IO.File]::WriteAllText($versionBackup.versionFile, $versionBackup.versionFileText, [System.Text.UTF8Encoding]::new($false))
        } elseif (Test-Path -LiteralPath $versionBackup.versionFile) {
            Remove-Item -LiteralPath $versionBackup.versionFile
        }
        Write-Host "Build incompleto; a versao do projeto foi restaurada para evitar pular uma numeracao."
    }
    $env:MARI_KEYSTORE_PATH = $previousEnvironment.MARI_KEYSTORE_PATH
    $env:MARI_KEYSTORE_PASSWORD = $previousEnvironment.MARI_KEYSTORE_PASSWORD
    $env:MARI_KEY_ALIAS = $previousEnvironment.MARI_KEY_ALIAS
    $env:MARI_KEY_PASSWORD = $previousEnvironment.MARI_KEY_PASSWORD
    $storePassword = $null
    $keyPassword = $null
}
