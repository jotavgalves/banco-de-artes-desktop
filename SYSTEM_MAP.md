# Banco de Artes - System Map

Este documento mapeia a arquitetura e os fluxos principais do aplicativo **Banco de Artes**, fornecendo uma visão geral para desenvolvedores e mantenedores.

## 🏗️ Visão Geral da Arquitetura

O aplicativo é construído com **Electron**, seguindo a arquitetura clássica de processos separados para garantir segurança e performance:

*   **Main Process (Backend):** Executa no Node.js. Responsável pelo acesso ao disco, integrações com APIs externas (Google Drive, Supabase) e automações pesadas (Photoshop).
*   **Renderer Process (Frontend):** Executa no Chromium. Responsável pela Interface do Usuário (UI), manipulação do DOM e estado local (State).
*   **Preload Script:** Atua como a ponte de segurança (IPC Bridge), expondo os métodos do Main Process para o Renderer através do objeto global `window.artBank`.

---

## 🖥️ Main Process (`src/main/`)

Responsável pela lógica de negócios pesada e persistência de dados.

### Serviços Principais
*   **`main.js`**: Ponto de entrada do Electron. Inicializa a janela, carrega os serviços e registra todos os manipuladores `ipcMain.handle`.
*   **`financeService.js`**: Lida com o processamento do "Carrinho" (lançamento de pedidos). Clona e copia pastas/arquivos no Google Drive para criar pacotes para clientes e extrai dimensões reais das imagens usando ImageMagick (`magick identify`).
*   **`financeHistoryService.js`**: Gerencia o histórico local (`finance_history.json`) dos pedidos lançados. Permite salvar, listar e expurgar pedidos antigos.
*   **`auditService.js`**: Sistema de log crítico. Mescla logs locais (guardados em `audit.json`) com logs salvos na nuvem (Supabase) para garantir rastreabilidade completa.
*   **`photoshopService.js`**: Executa scripts (via VBScript/AppleScript) para automatizar o Adobe Photoshop na geração de prévias e mockups automáticos.
*   **`googleService.js`**: Interface de comunicação com a API do Google Drive (Listagem, Cópia, Permissões).
*   **`supabaseService.js` / `supabaseArtworkService.js`**: Comunicação com o banco de dados Supabase para manter as artes, clientes e configurações sincronizados na nuvem.

---

## 🎨 Renderer Process (`src/renderer/`)

Responsável pela experiência do usuário, construída com HTML, CSS Vanilla e Javascript Modular.

### Core
*   **`index-premium.html`**: A estrutura monolítica do DOM. Contém todas as seções (Views), Modais principais (ex: `orderModal`, `orderViewModal`) e templates.
*   **`styles-premium.css`**: Design System completo. Utiliza variáveis CSS, Grid/Flexbox modernos e o conceito de *Glassmorphism* (Backdrops com blur). 
    * A sobreposição de telas é gerenciada estritamente via `z-index` (Modais Base: 90, Detalhes: 104, Carrinho: 105).
    * O alinhamento das grades de pedido (`.order-art-grid` e `.order-art-card`) força um comportamento de `stretch` e `height: 100%` para garantir a uniformidade vertical de todos os cards da UI.
*   **`core/boot.js`**: Orquestrador de inicialização. Faz o roteamento entre abas (ex: `showView()`) e gerencia os atalhos globais de eventos do menu lateral.
*   **`core/state.js`**: Objeto de estado global mutável (`state.financeItems`, `state.user`, etc.).

### Módulos de Interface (`modules/`)
*   **`finance.js`**: O módulo mais complexo da interface.
    *   **Carrinho (`#orderModal`)**: Controla a seleção de artes (`state.financeItems`), calcula metadados dinamicamente e orquestra o envio do pedido. Contém também o **Input Inteligente (Bulk)**, que permite inserção rápida de múltiplos IDs com letras de identificação (ex: `125A, 12H, go`), extraindo dimensões via backend para identificar precisamente as peças sem depender exclusivamente do nome dos arquivos.
    *   **Histórico (Sidebar)**: Lista pedidos passados.
    *   **Detalhamento (`#orderViewModal`)**: Reconstrói visualmente um pedido do passado (renderizando múltiplas imagens baseadas na quantidade comprada) e insere dimensões reais buscando via backend.
*   **`artworks.js`**: A Galeria principal. Busca imagens locais/Drive e gerencia filtros, pesquisa e a listagem visual em grid.
*   **`users.js`**: Gerencia perfis, travas de edição (`locks`) e aciona a tela de **Auditoria** (`refreshAudit`), populando as linhas com as ações mescladas (login, exclusões, cópias de pedido).
*   **`batch.js`**: Lida com processos em lote (upload/sincronização em massa).

---

## 🔄 Fluxos Críticos do Sistema

### 1. Fluxo de Lançamento de Pedido (Financeiro)
1. O usuário clica em **Adicionar ao pedido** em uma arte na galeria.
2. A arte entra em `state.financeItems` no Frontend.
3. Ao abrir o Carrinho (`orderModal`), o `finance.js` requisita as prévias e dimensões das artes via `window.artBank.previewFinanceOrder` e `measureDimensions`.
4. Ao clicar em **Lançar Pedido**, os dados viajam via IPC (`copyFinanceOrder`) para o `financeService.js`.
5. O `financeService.js` duplica as imagens no Drive sob o nome do Cliente.
6. Em caso de sucesso, o `financeHistoryService.js` salva os metadados do pedido localmente e o `auditService.js` gera um log crítico (`FINANCEIRO_COPIAR_PEDIDO`).

### 2. Fluxo de Histórico e Refação
1. O painel financeiro lista o histórico lendo `window.artBank.listFinanceHistory()`. A lista de histórico (contida dentro de `#financeEmptyState`) permanece visível na tela principal de Finanças em tempo integral, não sendo ocultada quando o carrinho recebe itens, garantindo que o usuário nunca perca o contexto do histórico ao navegar entre as telas ou fechar modais.
2. Ao **Visualizar** (`openOrderViewModal`), o sistema mapeia a quantidade pedida (ex: 3 cilindros) e exibe 3 cards fisicamente, refazendo o *match* com o banco de prévias e recarregando dimensões reais.
3. Ao clicar em **Usar artes em novo pedido**, o sistema injeta os IDs do histórico de volta no `state.financeItems` e abre o Carrinho (`orderModal`) **sobreposto** à visualização anterior (z-index 105 sobre 104), preservando o contexto visual para o usuário.

### 3. Fluxo de Auditoria (Logs)
1. Ações como Login Automático, Exclusão de Arte ou Lançamento de Pedido chamam a função global `auditService.log`.
2. Os logs são gravados no `audit.json` local e, se houver rede, no Supabase.
3. Ao clicar na aba "Auditoria" no Frontend (`boot.js` -> `bindNavigation`), o gatilho `refreshAudit()` é disparado.
4. O `auditService.list` mescla as duas fontes de forma cronológica reversa, garantindo que mesmo sem internet, logs críticos de máquina não sejam perdidos.

---

## 🐞 Bugs Conhecidos e Resolvidos

### 1. Dupla Contagem de Imagens no Drive (Fantasmas)
* **Sintoma:** O painel "Drive" mostrava "2 imagens" (ou mais) para pastas que possuíam apenas 1 imagem.
* **Causa:** 
    1. O Google Drive cria atalhos (`application/vnd.google-apps.shortcut`) que, por compartilharem o mesmo nome do arquivo original (ex: `foto.jpg`), escapavam pelo filtro `name contains '.jpg'`.
    2. Além disso, se uma pasta possuísse múltiplas rotas de origem (múltiplos pais via atalho), a varredura em "chunks" devolvia os itens repetidos e somava à árvore.
* **Solução:** Implementada uma desduplicação brutal via `Map`/`Set` usando IDs únicos e adicionada regra no `mimeTypeFilter` explícita `and mimeType != 'application/vnd.google-apps.shortcut' and mimeType != 'application/vnd.google-apps.folder'` (`googleService.js`).

### 2. TypeError: 'get' on proxy: property 'files' is read-only
* **Sintoma:** Crash silencioso ou falha visual ("Falha ao carregar Drive") que informava uma violação do proxy no motor de resiliência de autenticação do Google Drive.
* **Causa:** O Proxy do Javascript exigia que a leitura da propriedade estática `files` do objeto instanciado pelo `googleapis` devolvesse obrigatoriamente a mesma referência nativa (por conta da diretriz *non-configurable*). O wrapper `wrapDriveWithAuthRecovery` interceptava a tentativa e retornava um novo `Proxy(value)`, gerando pânico no motor JS.
* **Solução:** Mudança do alvo do proxy de `Proxy(drive)` para um objeto em branco `Proxy({})`, injetando os retornos limpos via `drive[prop]` no handler `get` internamente (`googleService.js`).

### 3. Falha de Atualização em Hot-Reload
* **Sintoma:** Atualizações no `src/main` (como em `googleService.js`) pareciam não surtir efeito após o uso do atalho de recarregamento (`Ctrl + R`).
* **Causa:** O Electron apenas recarrega o Renderer (frontend) nos atalhos tradicionais. Mudanças na raiz de inteligência do Node.js requerem um *hard restart* (fechar e abrir o software inteiramente).

### 4. Cards Vazando e Botões com Tamanhos Instáveis (CSS Grid vs Flexbox)
* **Sintoma:** Em grades (`display: grid` com colunas `auto-fill, minmax`), elementos internos de algumas células (como botões) ficavam largos ou espremidos dependendo do tamanho do texto no card, às vezes até sobrepondo a coluna vizinha (vazamento). Reticências (`text-overflow: ellipsis`) falhavam.
* **Causa:** O conflito entre regras globais de `display: flex` e regras específicas de `display: grid`. Quando um texto inquebrável (ex: um título longo) cresce, ele dita a largura mínima intrínseca da célula da grade inteira (`min-content` cascade), empurrando tudo em volta.
* **Solução:** 
    1. Redefinir a estrutura do card explicitamente como uma coluna flexível (`flex-direction: column`).
    2. Aplicar rigidamente `min-width: 0` e `overflow: hidden` em todos os contêineres pais na hierarquia para "quebrar" a corrente da largura intrínseca.
    3. Aplicar `flex: 1` à caixa de texto e `width: 100%` aos botões. Isso força os botões a usarem o tamanho blindado da coluna imposto pela grid superior em vez do tamanho do conteúdo.
