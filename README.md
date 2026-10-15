# Guitarra Guiada

Um "professor de bolso" para tablaturas: toca a música e, a cada nota ou acorde, mostra
**qual dedo vai em cada corda**, **se a palhetada é para baixo ou para cima**, **em que contagem
ela entra** ("1 e 2 e…") e **quanto tempo dura**.

## Como rodar

Precisa de Python (já instalado) e internet (o alphaTab vem de um CDN).

- Dê dois cliques em `iniciar.bat`, ou
- no terminal, dentro desta pasta: `py servidor.py` e abra http://localhost:8000

## Como usar

- **Tocar / Velocidade:** comece devagar (60–70%) com o metrônomo ligado.
- **Clique numa nota** da tablatura para ver os detalhes dela no painel.
- **Arraste sobre a tablatura** para escolher um trecho e marque **Repetir** para treiná-lo em loop.
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
- **Nomes dos acordes:** aparecem acima da tablatura sempre que o acorde muda (se o arquivo já
  traz nomes, eles são mantidos).

## Como funciona

| Arquivo | O que faz |
|---|---|
| `js/main.js` | Liga o alphaTab (desenho da tab + tocador) ao painel do professor |
| `js/analysis.js` | Nome do acorde, contagem, duração e sentido da palhetada |
| `js/fingering.js` | Escolhe os dedos: anotação do arquivo → dicionário de acordes → busca heurística |
| `js/diagram.js` | Desenha os diagramas de acorde em SVG |
| `js/tone.js` | Presets de timbre e pedaleira (distorção, tom, reverb) em Web Audio |
| `songs/*.atex` | Músicas embutidas, escritas em [alphaTex](https://alphatab.net/docs/alphatex/introduction) |

O dedilhado automático testa todas as combinações de dedos para cada forma, pontua cada uma
(esticar, pestana, usar o mindinho…) e escolhe a melhor sequência para a música inteira, evitando
pular a mão de um lado para o outro. Para os acordes abertos mais comuns, usa o dedilhado de dicionário.

## Para adicionar uma música embutida

1. Crie `songs/minha-musica.atex` (veja `smoke-on-the-water.atex` como exemplo).
2. Adicione uma linha na lista `SONGS` no começo de `js/main.js`.

## Observações

- O riff de Smoke on the Water foi transcrito a 112 BPM, com a segunda frase entrando no "e" do 4.
  Vale conferir de ouvido com a gravação.
- O som vem do banco FluidR3 (licença MIT, 14,5 MB), baixado do CDN na primeira vez e guardado
  no cache do navegador. Se não carregar, o app volta para o banco leve do alphaTab.
- Para a pedaleira pegar só na sua faixa, o app joga a sua faixa toda para o canal esquerdo e o
  resto (banda e metrônomo) para o direito antes de tocar, aplica os efeitos no esquerdo e soma os
  dois no centro. Por isso a banda toca em mono.
- O alphaTab 1.8.4 tem um bug: assinar o evento `midiLoaded` trava a página em recursão infinita.
  O app evita esse evento (veja o comentário em `js/main.js`).
- Pelo console do navegador dá para inspecionar o app com `guitarra.api` e `guitarra.state`.

## Próximas ideias

- Treino de troca de acordes ("quantas trocas de G para C em 1 minuto?") com recorde pessoal.
- Microfone para conferir se a nota tocada está certa.
- Histórico de prática e progresso por música.
