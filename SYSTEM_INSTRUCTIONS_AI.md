# Instruções de Sistema e Lições Aprendidas (AI SYSTEM INSTRUCTIONS)

Este documento guarda os registros de problemas críticos enfrentados durante o desenvolvimento e as soluções para evitar regressões. Ele deve ser lido por qualquer assistente de IA ou desenvolvedor trabalhando neste projeto.

## 1. Problema de "Loading Infinito" na busca de artes (Resolvido em Jun/2026)
**O que acontecia:**
O usuário abria a aba "Lançar Pedido" e ao digitar o código de uma arte e apertar Enter, a tela ficava escurecida com a mensagem "Buscando arte..." e a bolinha de carregamento ficava girando eternamente (loop infinito). O aplicativo travava completamente.

**A causa real:**
Quando a função de busca era iniciada (no renderer `finance.js`), ela chamava a função síncrona `setBusy()` para exibir a tela de loading.
A `setBusy()` chamava `startActionProgress()` (em `core/utils.js`).
A função `startActionProgress` tentava atualizar o título da barra de carregamento acessando o elemento pelo ID `#globalProgressTitle`:
`$("#globalProgressTitle").textContent = title;`

Porém, no HTML da versão premium (`index-premium.html`), esse elemento foi renomeado para `#globalProgressText`.
Como a chamada era síncrona, a ausência de tratamento de nulos (`?`) gerava um **TypeError ("Cannot set property textContent of null")**, que **abortava imediatamente** a execução da rotina.
O erro ocorria *após* a tela de loading ser exibida mas *antes* de a chamada IPC ser feita para o backend (Main Process) e *antes* de o bloco `try/catch` da função de busca ser iniciado. Consequentemente, o loading nunca era removido (`clearBusy()` não era chamada) e a aplicação congelava visualmente.

**A Solução Implementada:**
1. A função `startActionProgress` em `utils.js` foi corrigida para usar verificação de nulidade (null-check) e fallback:
   ```javascript
   if ($("#globalProgressTitle")) $("#globalProgressTitle").textContent = title;
   else if ($("#globalProgressText")) $("#globalProgressText").textContent = title;
   ```
2. Foi adicionado um **Timer de Segurança (Timeout)** em `finance.js` ao buscar artes (Timeout de 15 segundos). Se após 15s o backend não retornar, o UI é destravado compulsoriamente e um alerta é exibido, evitando que o usuário fique em loop eterno caso haja uma falha futura no IPC.

**Lições para a IA no futuro:**
- **Sempre utilize null-checks (`?.` ou `if (el)`) ao alterar propriedades do DOM**, principalmente em funções globais de UI que compartilham o mesmo arquivo `utils.js` mas operam em páginas HTML potencialmente diferentes (`index.html` vs `index-premium.html`).
- **Erros de sincronia no UI travam promessas**: Se um carregamento infinito ocorre e o backend não exibe logs, a falha ocorreu antes da chamada IPC, muito provavelmente por um erro de JavaScript (ex: syntax ou type error) não capturado.
- **Log do DevTools:** Lembre-se que em aplicativos distribuídos (sem terminal ativo para o renderer), o `console.log` e erros críticos do Renderer não chegam ao terminal do processo Main a menos que estejam conectados a um devtools ou log via IPC.

## 2. Erro de Ocultamento de Múltiplos Arquivos no Histórico (Resolvido em Jun/2026)
**O que acontecia:**
Ao visualizar artes de pedidos recentes no Histórico de Lançamentos (a barra lateral e o Modal `openOrderViewModal`), o sistema apresentava falhas na exibição visual quando múltiplas imagens pertenciam a uma arte com o mesmo código (ID), exibindo apenas a foto da *primeira* arte acompanhada da quantidade (ex: x3), ocultando as prévias e fotos visuais das demais peças lançadas.

**A causa real:**
Existiam dois problemas de agrupamento forçado no código de `finance.js`:
1. Na criação das pequenas fotos da *barra lateral* (`renderFinanceHistory`), os itens em `order.items` eram iterados e seus IDs armazenados em um objeto `counts`, o que forçava todos os arquivos (ex: Cilindro 128 e Tampa 128) a serem agrupados sob o código `'128'`. Por consequência, a imagem processada era somente a do primeiro arquivo da matriz correspondente (`p.previews[0]`).
2. No *Modal Visivo* de pedido (`openOrderViewModal`), durante a renderização (`grid.innerHTML = items.map...`), o sistema sempre capturava estaticamente `item.previews[0]`, gerando apenas um HTML final. Isso mascarava os cenários onde o objeto de carrinho já reunia diferentes imagens sob o mesmo registro (`item.files` contendo múltiplas URLs de imagens lançadas por fora de kits).

**A Solução Implementada:**
1. A função `renderFinanceHistory` foi reescrita de modo a **não agrupar** peças por ID nos cards visuais. O total de peças e `uniqueIds` foram mantidos para buscar as dimensões com o backend sem saturar a rede, mas o array que gera o DOM (`thumbHtml`) passou a varrer puramente o vetor `order.items`. Dessa forma, cada miniatura enviada ganha uma imagem exclusiva.
2. O construtor HTML `openOrderViewModal` do Modal trocou a abordagem de varredura (map fixo na primeira foto `[0]`) para utilizar um `.flatMap` associado ao `.map` do vetor de previews, gerando assim *Múltiplos Cards* dentro do modal mesmo caso apenas 1 "item" no vetor representasse múltiplos arquivos lançados ao mesmo tempo.

**Lições para a IA no futuro:**
- **A Interface não deve agrupar o que foi lançado individualmente:** A renderização de relatórios/históricos deve exibir precisamente a representação do carrinho que foi enviado (um pra um). Nunca agrupar ou somar quantidades perdendo referências das thumbnails originais (cada peça deve ter sua prévia visual respeitada).
- O backend de prévias via IPC pode devolver uma chave com N imagens, mas a interface do usuário sempre precisa refletir o que o usuário escolheu (via array genérico `files`).
