# ROUTINE 2.0

## Linha de segurança

- A branch `routine-1.0` é a cópia congelada da versão estável anterior ao início do ROUTINE 2.0.
- Nenhuma alteração da 2.0 deve ser aplicada à branch `routine-1.0`.
- A branch `routine-2.0` é o ambiente de desenvolvimento da nova versão.
- O deploy de produção continua vinculado apenas à branch `main`.

## Escopo da 2.0

ROUTINE 2.0 = ROUTINE 1.0 + camada de tarefas/To Do:

- tarefas vinculadas opcionalmente a uma rotina;
- tarefas independentes;
- prazo por data e horário;
- projeto/contexto opcional;
- prioridade e status;
- checklist por tarefa;
- pendências anteriores;
- visão Hoje, Semana, Todas e Concluídas;
- busca e filtro por rotina;
- progresso das rotinas baseado nas tarefas do dia;
- aderência diária como média do progresso das rotinas planejadas;
- atividades sem tarefas continuam com conclusão manual;
- bloco "O que fazer agora?";
- proteção contra duplicação no frontend e backend;
- melhoria de legibilidade e ações mais explícitas.

## Regra de aderência

Se uma rotina possui tarefas com prazo no dia, o progresso da rotina é:

`tarefas concluídas / tarefas previstas no dia`

Se não possui tarefas no dia, a rotina vale 100% apenas quando marcada como concluída.

A aderência do dia é a média do progresso de todas as rotinas planejadas para aquele dia.
