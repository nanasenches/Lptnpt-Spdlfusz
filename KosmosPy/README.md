# KosmosPy

Repositório do aplicativo Android KosmosPy e do catálogo público de dados RocketPy.

## Estrutura principal

- `foguetes/`: catálogo que o aplicativo consulta online; também contém os pacotes completos para baixar e guardar no celular.
- `public/foguetes/`: cópia incorporada ao APK para o primeiro uso e operação offline. Ela é atualizada automaticamente a partir de `foguetes/` antes da compilação.
- `app/`, `components/`, `lib/`, `android/`: código-fonte do aplicativo e projeto Android.
- `.github/workflows/validar-catalogo.yml`: valida alterações no catálogo enviadas ao GitHub.
- `.github/workflows/publicar-apk.yml`: compila e publica APK quando uma tag `vX.Y.Z` é enviada.
- `docs/FOGUETES-E-RELEASES.md`: instruções para acrescentar foguetes e gerar APKs.

## Adicionar ou atualizar dados

Crie ou atualize `foguetes/<id>/` com `manifest.json` e os arquivos declarados nele. Atualize `foguetes/catalogo.json` e aumente `versao_dados` quando modificar um pacote existente. O identificador da pasta deve ser minúsculo e pode conter números e hífens.

O GitHub Actions confere se o catálogo, os manifestos e os arquivos obrigatórios estão coerentes. Depois que as alterações forem enviadas para `main`, o aplicativo consulta o catálogo e oferece os dados novos para download. O app guarda os pacotes baixados localmente para uso offline.

## APK e releases

O APK pode ser gerado localmente com `GERAR-NOVO-APK.bat` ou publicado automaticamente ao enviar uma tag como `v1.5.5`. Antes de criar a tag, atualize `versionName` e aumente `versionCode` em `android/app/build.gradle`. O workflow verifica se tag e `versionName` correspondem, compila o APK assinado e o anexa à Release. Arquivos de dados de foguetes ficam em `foguetes/`; Releases são para os APKs instaláveis.

Para habilitar a publicação automática, configure estes secrets no repositório: `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_STORE_PASSWORD`, `ANDROID_RELEASE_KEY_PASSWORD` e `ANDROID_RELEASE_KEY_ALIAS`. O primeiro contém a chave oficial codificada em Base64; os demais são as credenciais da assinatura. O workflow só usa esses secrets ao publicar uma tag.

No Windows, o Base64 da chave pode ser calculado localmente no PowerShell com `[Convert]::ToBase64String([IO.File]::ReadAllBytes('CAMINHO-LOCAL-DA-CHAVE.jks'))`. Cadastre os quatro valores em **Settings → Secrets and variables → Actions → New repository secret**. Não cole a chave nem as senhas em arquivos versionados, issues ou mensagens. O alias atual é `kosmos-mari-release`.

## Assinatura Android

Nunca envie ao GitHub arquivos `.jks`, `.keystore`, `android/keystore.properties`, senhas ou arquivos `local.properties`. Para compilar localmente, siga `LEIA-ME-PRIMEIRO.txt` e `docs/FOGUETES-E-RELEASES.md`.
