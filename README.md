# Palheta

Um "professor de bolso" para tablaturas: toca a música e, a cada nota ou acorde, mostra
**qual dedo vai em cada corda**, **se a palhetada é para baixo ou para cima**, **em que contagem
ela entra** ("1 e 2 e…") e **quanto tempo dura**.

## Como rodar

**Pelo link, sem instalar nada** (PC, celular ou tablet): https://gcgoomes.github.io/Palheta/
(funciona depois que o GitHub Pages estiver ligado, veja abaixo).

**No próprio PC:** precisa de Python e internet (o alphaTab vem de um CDN).

- Dê dois cliques em `iniciar.bat` (usa o `py` ou o `python`, o que existir), ou
- no terminal, dentro desta pasta: `py servidor.py` e abra http://localhost:8000

### Publicar no GitHub Pages

O app é só HTML, CSS e JavaScript, então o GitHub pode hospedá-lo de graça. No plano gratuito,
o repositório precisa ser público. Em **Settings → Pages**, escolha **Deploy from a branch**,
branch **main**, pasta **/(root)**, e salve. Cada `git push` no `main` atualiza o site em 1 ou 2
minutos. O arquivo `.nojekyll` faz o GitHub servir os arquivos como estão.

## Como usar

- **Tocar / Velocidade:** comece devagar (60–70%) com o metrônomo ligado.
- **Clique numa nota** da tablatura para ver os detalhes dela no painel.
- **Arraste sobre a tablatura** para escolher um trecho e marque **Repetir** para treiná-lo em loop.
  No celular, use **Repetir este compasso** (abaixo da faixa de batida).
- **Desafio de velocidade:** começa em 50% e sobe 5% a cada volta completa, até a velocidade original.
- **Pêndulo / Riff:** dois jeitos de decidir a palhetada.
  - *Pêndulo*: a mão nunca para. Desce nos tempos e sobe nos "e". Ideal para batida de acordes.
  - *Riff*: quando há tempo entre as notas, palheta para baixo (mais peso); nas notas rápidas, alterna.
- **Abrir arquivo:** aceita Guitar Pro (`.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`), MusicXML e alphaTex.
  Também dá para arrastar o arquivo para a janela. O app escolhe sozinho a primeira faixa de guitarra;
  troque no seletor de faixas se quiser outra.
- **Volume das faixas:** abra o painel abaixo dos controles para ajustar o volume de cada instrumento
  (0–150%) ou silenciá-lo. "Só a minha faixa" e "Banda toda" são atalhos.
- **Timbre da guitarra:** presets (Original, Violão, Limpo, Crunch, Distorção, Pesado) e ajustes
  de distorção, tom (grave ↔ agudo) e reverb. Os efeitos pegam só na sua faixa; o app lembra a
  sua escolha na próxima vez.
- **Banco de sons** (no painel de timbre): FluidR3, MuseScore General, GeneralUser GS ou Sonivox.
  Troque com a música tocando para comparar; o volume da guitarra é igualado entre os bancos para a
  comparação ser justa.
- **Nomes dos acordes:** aparecem acima da tablatura sempre que o acorde muda (se o arquivo já
  traz nomes, eles são mantidos).
- **Treinar trocas** (no cartão "Formas desta música"): escolha um par de formas que aparecem em
  sequência na música (ex.: G5 ⇄ B♭5). O metrônomo conta 4 e marca quando trocar; cada rodada tem
  8 trocas. No fim, diga como foi: "saiu limpo" sobe 5 BPM e pode virar recorde. Passando de
  120 BPM, o treino passa a trocar mais vezes por compasso. As dicas mostram o dedo que fica parado
  (âncora) ou que desliza pela corda (dedo-guia).
- **Seu progresso:** tempo de prática por dia (conta enquanto a música ou o treino tocam), dias
  seguidos (com pelo menos 1 minuto), os últimos 7 dias e os recordes da música aberta: velocidade
  numa volta completa (na música inteira ou num trecho com Repetir) e BPM em cada troca. Uma volta só
  vale se começar no início da música ou do trecho, e conta a menor velocidade usada nela. Fica
  guardado neste navegador.

## Como funciona

| Arquivo | O que faz |
|---|---|
| `js/main.js` | Liga o alphaTab (desenho da tab + tocador) ao painel do professor |
| `js/analysis.js` | Nome do acorde, contagem, duração e sentido da palhetada |
| `js/fingering.js` | Escolhe os dedos: anotação do arquivo → dicionário de acordes → busca heurística |
| `js/diagram.js` | Desenha os diagramas de acorde em SVG |
| `js/tone.js` | Presets de timbre e pedaleira (distorção, tom, reverb) em Web Audio |
| `js/trainer.js` | Treino de trocas de acordes, com metrônomo próprio |
| `js/progress.js` | Tempo de prática, dias seguidos e recordes (localStorage) |
| `songs/*.atex` | Músicas embutidas, escritas em [alphaTex](https://alphatab.net/docs/alphatex/introduction) |

O dedilhado automático testa todas as combinações de dedos para cada forma, pontua cada uma
(esticar, pestana, usar o mindinho…) e escolhe a melhor sequência para a música inteira, evitando
pular a mão de um lado para o outro. Para os acordes abertos mais comuns, usa o dedilhado de dicionário.

## Para adicionar uma música embutida

1. Crie `songs/minha-musica.atex` (veja `smoke-on-the-water.atex` como exemplo).
2. Adicione uma linha na lista `SONGS` no começo de `js/main.js`.

## Observações

- O riff de Smoke on the Water (112 BPM) foi conferido nota a nota com uma tablatura Guitar Pro da
  música: mesmas entradas, durações e o "x" abafado no tempo 4.
- Bancos de sons:
  - **FluidR3** (licença MIT, 14,5 MB): vem do CDN do jsDelivr (cópia do repositório do MuseScore).
  - **MuseScore General 0.2** (licença MIT, 40 MB): o banco do MuseScore 3, derivado do FluidR3.
    Cópia local em `sons/` com os créditos (o servidor oficial não libera o download por outro site).
    As guitarras usam as mesmas amostras do FluidR3; a diferença aparece mais na banda.
  - **GeneralUser GS 2.0.3** (32 MB), de S. Christian Collins: cópia local em `sons/`, junto com a
    licença. O autor permite o uso em projetos, mas pede que sites usem uma cópia própria em vez de
    apontar para os arquivos dele.
  - **Sonivox** (1,3 MB): vem com o alphaTab. Se o banco escolhido não carregar, o app usa este.
- Para a pedaleira pegar só na sua faixa, o app joga a sua faixa toda para o canal esquerdo e o
  resto (banda e metrônomo) para o direito antes de tocar, aplica os efeitos no esquerdo e soma os
  dois no centro. Por isso a banda toca em mono.
- O alphaTab 1.8.4 tem um bug: assinar o evento `midiLoaded` trava a página em recursão infinita.
  O app evita esse evento (veja o comentário em `js/main.js`).
- Pelo console do navegador dá para inspecionar o app com `palheta.api`, `palheta.state` e
  `palheta.tone.levels()` (volume de cada lado da separação guitarra/banda).

## Próximas ideias

- Biblioteca: listar os arquivos de uma pasta e lembrar onde você parou em cada música.
- Microfone para conferir se a nota tocada está certa.
- Tocar junto com a gravação original (o alphaTab sincroniza a tab com um áudio).
