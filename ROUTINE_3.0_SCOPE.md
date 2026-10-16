# ROUTINE 3.0 — escopo interno

ROUTINE 3.0 é uma linha de evolução interna criada a partir da ROUTINE 2.0 atual.

- A identificação "3.0" não deve ser adicionada à interface apenas por causa desta organização técnica.
- ROUTINE 1.0 permanece congelada em `routine-1.0`.
- ROUTINE 2.0 permanece preservada em `routine-2.0`.
- ROUTINE 3.0 evolui em `routine-3.0`.
- O ambiente continua sendo um único site MonsterASP.NET e o mesmo banco de produção.
- Novas evoluções devem ser aditivas e compatíveis com rollback sempre que possível.

## Primeira evolução

A tela **Minha rotina** passa a oferecer três visualizações sobre os mesmos dados:

1. **Calendário** — visão diária por horário, com blocos proporcionais à duração, navegação por data, linha de horário atual e destaque da atividade em andamento.
2. **Kanban** — preserva a experiência de cards existente na ROUTINE 2.0.
3. **Lista** — visão cronológica compacta do dia selecionado.

A última visualização escolhida é persistida localmente no navegador.
