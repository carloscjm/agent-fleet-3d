# Propostas de visualização

O dashboard mostra o pipeline como um fluxo 3D. As demais abaixo são direções para as próximas versões; todas consomem o mesmo `projectDetail()` de `shared/fleet-core.mjs`, então trocar ou somar uma visão não mexe na coleta.

## Implementada

**Fluxo do pipeline.** Uma linha por sessão: Sessão → Tech Lead → Engenheiro → QA → DevOps → Git, ligadas por uma esteira. Cada estação tem uma forma própria (octaedro para o plano, cubo para a construção, anel para o teste, foguete para a entrega) e muda de cor com o estado. O pacote de trabalho anda pela esteira até a etapa atual, os trechos já percorridos acendem, e um caminho no chão leva a tarefa do QA de volta ao Engenheiro quando ele reprova. Atrás de cada estação, uma pilha de placas mostra os últimos passos.

As visões anteriores, **Órbitas** e **Trilhas**, foram substituídas pelo fluxo na versão 0.3.0.

## Próximas sugestões

**1. Grafo de forças 3D (3d-force-graph).** Nós para agentes, arquivos e skills; arestas quando um agente lê ou edita um arquivo. Mostra colisões (dois agentes editando o mesmo arquivo) e quais skills estão em uso. Custo: médio, a biblioteca resolve o layout.

**2. Cidade isométrica.** Cada projeto é um quarteirão, cada agente um prédio; altura = número de ferramentas, andares acesos = passo atual, cor = estado. Boa para uma "visão de frota" com muitos projetos ao mesmo tempo, em monitor de parede.

**3. Linha do tempo do pipeline.** Uma barra por etapa, com a duração de cada tentativa; retrabalhos aparecem como barras repetidas do Engenheiro e do QA. Responde onde o pipeline perde mais tempo.

**4. Hélice do tempo.** Os passos de um agente sobem numa espiral ao longo do eixo Y (tempo); voltas mais largas = passos mais longos. Bonita para replay de uma sessão inteira com um controle de linha do tempo.

**5. Metrô.** Cada agente é uma linha de metrô; ferramentas são estações e delegações viram baldeações para a linha do subagente. Legível em 2.5D, ótima para explicar a execução a quem não é técnico.

**6. Mapa de calor do repositório.** A árvore de diretórios do projeto como blocos empilhados (treemap 3D); blocos brilham quando um agente lê ou edita o arquivo. Responde "onde no código os agentes estão mexendo".

## Ideias transversais

- **Replay**: os eventos já ficam em `~/.agent-fleet/events.jsonl`; um controle de tempo pode reproduzir qualquer sessão em qualquer visão.
- **Custo**: somar tokens por agente (via `transcript_path`) e usar como tamanho do corpo.
- **Ações**: botão para abrir o terminal da sessão ou interromper um agente travado (exige integração com o Claude Code além dos hooks).
