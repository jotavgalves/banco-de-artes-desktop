# Implementação do Validador de Medidas Físicas e Filtro por Produto

Este plano visa resolver a ausência do carregamento das miniaturas (que foi quebrada por uma falha de conversão de caracteres no HTML), e adicionar a verificação de dimensões físicas de imagens de acordo com o produto escolhido no painel de Lote (Cadastro).

## ⚠️ User Review Required / Open Questions

> [!IMPORTANT]
> **Como devemos converter Pixels para Centímetros?**
> Módulos de leitura de imagens (como `image-size` ou `jimp`) identificam o tamanho da imagem em **PIXELS** (largura x altura). Para saber quantos centímetros a imagem tem fisicamente, precisamos saber qual é o **DPI / Resolução (Pixels por Polegada)** esperado para a impressão dessas artes.
> - As suas artes possuem um padrão fixo de exportação (ex: **100 DPI**, **72 DPI**, **300 DPI**)?
> - Ou o aplicativo deve ler o DPI de dentro do cabeçalho original da imagem e fazer o cálculo baseado no DPI embutido em cada arquivo? (Obs: JPEGs baixados da internet costumam vir sem DPI definido).
>
> Por favor, **responda qual regra de DPI** você quer que eu aplique para os cálculos de "cm" no backend! 
> *(Ex: se for 100 DPI, 58cm = 2283 pixels. Se for 72 DPI, 58cm = 1644 pixels).*

## Proposed Changes

---

### Módulo de Banco de Artes (Backend)
Será modificado o `fileService.js` ou adicionado um scanner de metadados:

#### [MODIFY] [fileService.js](file:///c:/Users/CRIACAO/Desktop/Projeto/src/main/fileService.js)
- Integração da leitura da largura e altura (pixels) de cada imagem escaneada.
- Cálculo da dimensão em `cm` baseada no DPI definido e inserção dos tamanhos inferidos no objeto final que é mandado ao Frontend (`widthCm`, `heightCm`).

### Módulo de Lote / Cadastro (Frontend)
A interface receberá o seletor de produtos e as mecânicas de alerta de tamanho.

#### [MODIFY] [app-premium.js](file:///c:/Users/CRIACAO/Desktop/Projeto/src/renderer/app-premium.js)
- **Correção TIFF/JPGE:** Modificação da string do HTML `onerror="... window.recoverThumb(this, '${safePath}')"` para usar `data-path`, blindando contra qualquer caractere especial (como aspas simples no nome da pasta/arquivo) que está provocando quebras de sintaxe no Chrome e silenciando o fallback do Jimp.
- **Seletor de Produto:** Injeção de um elemento `<select id="batchProductFilter">` no mesmo painel superior (`.panel-header` ou `.toolbar`) ao lado do botão "Escolher pasta".
- **Lógica de Validação e Filtragem:** Implementação de verificação:
  - **Bolinha:** Alerta se não estiver entre `57x57` e `60x60` cm. (Regra: 58x58 com margem -1 e +2).
  - **Painel 150:** Alerta se não encaixar em `157-159 x 157-159` cm OU `162-164 x 157-159` cm.
- **Feedback Visual:** Linhas de tabelas que fugirem do tamanho ganharão destaques e um alerta unificado aparecerá avisando o usuário sobre arquivos inconsistentes na pasta.

## Verification Plan

### Manual Verification
1. Selecionar uma pasta mesclada com imagens perfeitas e imagens redimensionadas erroneamente.
2. Trocar o Seletor de Produto na interface para "Bolinha". O aplicativo deverá filtrar apenas quem encaixa na tolerância e disparar o alerta das imagens que falharam.
3. Repetir para "Painel 150".
4. Conferir a tela do lote com arquivos TIFF/JPGE que possuem apóstrofos/espaços em seus nomes, garantindo que a injeção assíncrona do `Jimp` renderize-os perfeitamente agora.