# Propostas de visualização

O dashboard já traz duas visualizações sobre os mesmos dados (botões **Órbitas** e **Trilhas**). As demais abaixo são direções para as próximas versões; todas consomem o mesmo `projectDetail()` de `shared/fleet-core.mjs`, então trocar ou somar uma visão não mexe na coleta.

## Implementadas

**1. Órbitas (padrão).** O projeto é um núcleo; cada sessão principal orbita o núcleo e cada subagente orbita a sessão que o criou, ligado por uma linha tracejada. Os últimos 12 passos seguem o agente como um rastro de pequenos cubos coloridos pelo tipo de ferramenta (leitura, edição, comando, web, delegação, skill). Um anel girando indica ferramenta em execução; o halo pisca quando o agente espera você. Melhor para responder "quem está fazendo o quê agora e quem criou quem".

**2. Trilhas.** Uma trilha por agente; cada passo vira uma barra, com altura proporcional à duração (escala log) e o passo mais novo na ponta. Melhor para ver ritmo, gargalos (barras altas) e erros em sequência (barras vermelhas).

## Próximas sugestões

**3. Grafo de forças 3D (3d-force-graph).** Nós para agentes, arquivos e skills; arestas quando um agente lê ou edita um arquivo. Mostra colisões (dois agentes editando o mesmo arquivo) e quais skills estão em uso. Custo: médio, a biblioteca resolve o layout.

**4. Cidade isométrica.** Cada projeto é um quarteirão, cada agente um prédio; altura = número de ferramentas, andares acesos = passo atual, cor = estado. Boa para uma "visão de frota" com muitos projetos ao mesmo tempo, em monitor de parede.

**5. Hélice do tempo.** Os passos de um agente sobem numa espiral ao longo do eixo Y (tempo); voltas mais largas = passos mais longos. Bonita para replay de uma sessão inteira com um controle de linha do tempo.

**6. Metrô.** Cada agente é uma linha de metrô; ferramentas são estações e delegações viram baldeações para a linha do subagente. Legível em 2.5D, ótima para explicar a execução a quem não é técnico.

**7. Mapa de calor do repositório.** A árvore de diretórios do projeto como blocos empilhados (treemap 3D); blocos brilham quando um agente lê ou edita o arquivo. Responde "onde no código os agentes estão mexendo".

## Ideias transversais

- **Replay**: os eventos já ficam em `~/.agent-fleet/events.jsonl`; um controle de tempo pode reproduzir qualquer sessão em qualquer visão.
- **Custo**: somar tokens por agente (via `transcript_path`) e usar como tamanho do corpo.
- **Ações**: botão para abrir o terminal da sessão ou interromper um agente travado (exige integração com o Claude Code além dos hooks).
