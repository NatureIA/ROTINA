# ROUTINE 2.0

## Linha de segurança

- A branch `routine-1.0` é a cópia congelada da versão estável anterior ao início do ROUTINE 2.0.
- Nenhuma alteração da 2.0 deve ser aplicada à branch `routine-1.0`.
- A branch `routine-2.0` é o ambiente de desenvolvimento da nova versão.
- A branch `main` representa a versão publicada no único website de produção.
- ROUTINE 1.0 e ROUTINE 2.0 utilizam o mesmo website e o mesmo banco quando estão em produção; a separação é feita por versão de código no GitHub, não por infraestrutura.

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


## Homologação técnica

A branch `routine-2.0` possui workflow próprio de validação e NÃO faz deploy enquanto estiver fora da `main`. Quando aprovada, será integrada à `main`, que publica no mesmo website MonsterASP já utilizado pela ROUTINE 1.0.

A cada alteração são validados:

- sintaxe do JavaScript principal;
- sintaxe do PWA e service worker;
- JSON do manifest;
- restore .NET;
- build Release;
- publish Windows x86, igual ao formato utilizado no MonsterASP.

A produção permanece ligada exclusivamente à `main`.

## Rollback

Baseline oficial ROUTINE 1.0:

- branch: `routine-1.0`
- commit: `2b1c7beebde588fb13353fa872034904eaeb1f9c`

A branch ROUTINE 1.0 não recebe desenvolvimento da 2.0.
