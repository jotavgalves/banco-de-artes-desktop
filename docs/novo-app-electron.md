# Novo Banco de Artes - Arquitetura Alvo

## Resumo

O sistema atual em `main.py` passa a ser a planta de regras do novo aplicativo. A nova versao sera um aplicativo desktop em Electron, com interface propria, sem CMD e sem depender de arquivo `.bat` para abrir.

## Decisoes

- O app sera desktop com Electron.
- A interface sera visual, com formularios, tabelas, estados de validacao, icones e animacoes discretas.
- Tudo que hoje esta fixo ou escondido em codigo deve ser configuravel dentro do app.
- Quando as bases nao existirem, o sistema deve cria-las automaticamente.
- Quando existirem, o usuario admin pode redirecionar o app para outras bases/pastas.
- Google Sheets e Google Drive continuam como infraestrutura inicial, mas acessados por uma camada organizada e verificavel.

## Bases Configuraveis

- Planilha central de base de dados.
- Abas da base central: usuarios, configuracoes, logs administrativos e execucao.
- Planilha operacional de artes.
- Abas operacionais: cadastro e logs.
- Pasta raiz do Google Drive.
- Pastas locais de entrada de imagens.
- Extensoes aceitas.
- Produtos validos.
- Privacidade dos uploads.
- Permissao de cadastro sem padrao.
- Modo manutencao.

## Fluxos Principais

### Primeiro Acesso

1. Abrir o app.
2. Detectar se existem credenciais Google e sessao valida.
3. Permitir autenticar com Google.
4. Procurar ou criar planilha central.
5. Criar abas e cabecalhos obrigatorios.
6. Criar usuario admin inicial.
7. Levar o admin para uma tela de configuracao guiada.

### Cadastro de Artes

1. Usuario faz login.
2. App carrega configuracoes ativas.
3. Usuario seleciona ou usa pastas locais configuradas.
4. App lista imagens candidatas em tabela.
5. O cadastro padrao interpreta nomes existentes.
6. O cadastro manual abre um formulario de lote com linhas editaveis.
7. App valida nomes, IDs, produtos, tamanhos, duplicidades e Drive.
8. Usuario revisa resumo antes de enviar.
9. App adquire lock global e local.
10. App faz upload, grava planilha, atualiza cache e gera relatorio.
11. Falhas vao para uma area de quarentena preservada, nunca apagada sem acao explicita.

### Configuracoes Admin

O admin pode trocar ou criar:

- Planilha central.
- Planilha operacional.
- Nome das abas.
- Pasta raiz do Drive.
- Pastas locais monitoradas.
- Produtos validos.
- Privacidade dos arquivos.
- Regras de cadastro.
- Usuarios e senhas.
- Locks e quarentena.

## Regras Fortes

- Lock global so pode ser liberado pela execucao dona do token, exceto por acao admin explicita.
- Upload e gravacao devem registrar estado de progresso e falhas.
- Arquivos com erro devem ser preservados em quarentena com motivo.
- Credenciais e tokens nao devem ficar misturados com arquivos do app.
- Senhas devem usar hash com sal e custo.
- Nenhuma configuracao critica deve exigir alterar codigo.

## Primeira Entrega Implementavel

1. Base Electron rodavel.
2. Shell visual com navegacao lateral.
3. Tela de dashboard.
4. Tela de configuracoes redirecionaveis.
5. Tela de cadastro em lote com tabela e formulario manual.
6. Modulo local de regras de nomes/produtos/tamanhos.
7. Ponte inicial para reaproveitar a autenticacao e as chamadas Google existentes.

