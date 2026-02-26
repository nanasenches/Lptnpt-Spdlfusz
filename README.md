🚀 **Projetos OpenRocket**

Repositório destinado ao versionamento dos modelos desenvolvidos no OpenRocket. 
Arquivos .eng também fazem parte do repositório quando utilizados nas simulações.

📂 **Estrutura**
/NOME_DO_FOGUETE_vX.Y
   NomeProjeto_vX.Y.ork

/motores
   MotorProjeto_vX.eng

/exports
   NomeProjeto_vX.Y_report.pdf
   NomeProjeto_vX.Y_render.png

    Onde:
        X → versão principal (mudanças estruturais relevantes)
        Y → ajustes menores (posicionamento, massa, refinamentos)

    Exemplos
        Atlas_v1.0.ork
        Atlas_v1.1.ork
        Atlas_v2.0.ork

    Uma nova versão deve ser criada quando houver:
        Alteração de massa
        Mudança de motor
        Modificação de geometria 
        Ajustes estruturais internos
