# ROUTINE 2.0 — Homologação e publicação

## Baseline preservada

A ROUTINE 1.0 permanece congelada em:

- branch: `routine-1.0`
- commit: `2b1c7beebde588fb13353fa872034904eaeb1f9c`

A produção permanece na `main` até aprovação explícita da ROUTINE 2.0.

## Validação automática obrigatória

Antes de qualquer merge para `main`, o workflow **Validate ROUTINE 2.0** deve terminar com sucesso em todas as etapas:

1. JavaScript principal, PWA e Service Worker.
2. Estrutura da interface e IDs utilizados pelo JavaScript.
3. Restore .NET.
4. Build Release.
5. Testes automatizados das regras de negócio.
6. Publish Windows x86 compatível com MonsterASP.

## Cenários funcionais de homologação

### Usuários e isolamento
- Entrar com dois usuários diferentes.
- Confirmar que rotina, tarefas, execuções e histórico de um usuário não aparecem para outro.

### Rotinas
- Criar rotina.
- Tentar criar a mesma rotina novamente e confirmar bloqueio de duplicidade.
- Editar rotina.
- Pausar e reativar.
- Arquivar e confirmar que ela desaparece da rotina atual.
- Confirmar que o histórico anterior permanece disponível após arquivamento.

### To Do
- Criar tarefa independente.
- Criar tarefa vinculada a uma rotina.
- Criar tarefa diretamente pelo card da rotina.
- Editar título, contexto, prazo, horário e prioridade.
- Iniciar, concluir, reabrir e marcar como não realizada.
- Confirmar bloqueio de tarefa duplicada para mesma rotina/prazo.
- Confirmar comportamento das pendências anteriores.

### Checklist
- Adicionar item.
- Marcar e desmarcar.
- Excluir item.
- Confirmar atualização do contador do checklist.

### Aderência
- Rotina sem tarefas: conclusão manual define 0% ou 100%.
- Rotina com tarefas: percentual = tarefas concluídas no prazo do dia / tarefas previstas.
- Tarefa concluída atrasada não altera retroativamente a aderência do dia de vencimento.
- Arquivar uma rotina não apaga a aderência dos dias anteriores ao arquivamento.
- Aderência diária = média do progresso das rotinas planejadas.

### Histórico
- Confirmar registro de execução manual.
- Confirmar registro de tarefas concluídas.
- Confirmar uso da data real de conclusão.
- Confirmar que uma rotina arquivada continua identificável no histórico.

### PWA / Mobile
- Instalar o ROUTINE como PWA.
- Abrir sem barra do navegador em modo standalone.
- Testar Hoje, Minha rotina, To Do, drawer de tarefa e modais em celular.
- Confirmar que uma atualização de versão troca o cache do Service Worker.

## Publicação

Somente após homologação:

1. Confirmar workflow verde na cabeça atual de `routine-2.0`.
2. Confirmar que a PR #1 continua apontando de `routine-2.0` para `main`.
3. Fazer merge da PR.
4. Aguardar o workflow de produção da `main`.
5. Verificar `/health`:
   - `status: ok`
   - `database: ready`
   - `version: 2.0`
6. Fazer login.
7. Validar criação de uma tarefa e leitura dos dados existentes da 1.0.

## Banco de dados

A evolução 2.0 é aditiva. Ela adiciona tabelas/colunas sem remover as estruturas utilizadas pela ROUTINE 1.0.

Principais estruturas novas:

- `RoutineTasks`
- `ChecklistItems`
- `Activities.ClientRequestId`
- `Activities.ArchivedAt`
- `Activities.ArchivedWasActive`
- `RoutineTasks.CompletedAt`

## Rollback

Se houver problema após publicação:

1. Reverter a `main` para o commit da ROUTINE 1.0:
   `2b1c7beebde588fb13353fa872034904eaeb1f9c`
2. Executar novamente o deploy da `main`.
3. Não remover as tabelas/colunas criadas pela 2.0; a ROUTINE 1.0 simplesmente as ignora.
4. Não apagar dados da 2.0 durante o rollback.

Observação: rotinas arquivadas na 2.0 permanecem fisicamente no banco com `Active = false`. Em um rollback para a interface 1.0 elas podem aparecer como pausadas em "Minha rotina", pois a 1.0 não conhece o conceito de arquivamento. Isso não provoca perda de dados.


## Estratégia correta de versão e publicação

O ROUTINE utiliza **um único website e um único banco de dados**.

### ROUTINE 1.0

A versão 1.0 fica preservada como referência oficial de rollback:

- branch: `routine-1.0`
- commit imutável: `2b1c7beebde588fb13353fa872034904eaeb1f9c`

Essa branch não recebe mais desenvolvimento. Ela existe apenas para permitir retorno rápido à versão estável anterior.

### ROUTINE 2.0

O desenvolvimento ocorre na branch:

- `routine-2.0`

Quando a homologação estiver aprovada, a PR da 2.0 será integrada à `main`.

### Produção

A branch `main` representa o que está efetivamente publicado em:

- `https://routine.runasp.net`

O workflow de produção existente publica a `main` no **mesmo website MonsterASP** e utiliza o **mesmo banco MSSQL** configurado no site.

Fluxo:

```
routine-1.0  = backup congelado
routine-2.0  = desenvolvimento
main         = produção

Quando aprovado:
routine-2.0 -> main -> mesmo MonsterASP -> mesmo banco
```

## Rollback real para ROUTINE 1.0

Se a ROUTINE 2.0 apresentar um problema grave após entrar em produção:

1. restaurar a `main` para o commit oficial da ROUTINE 1.0:
   `2b1c7beebde588fb13353fa872034904eaeb1f9c`
2. executar novamente o workflow de produção;
3. o mesmo `routine.runasp.net` volta a servir o código da ROUTINE 1.0;
4. o mesmo banco continua sendo utilizado;
5. as tabelas e colunas extras criadas pela 2.0 permanecem no banco, mas a 1.0 simplesmente as ignora.

Não existe necessidade de segundo website ou segundo banco para esse modelo de rollback.

### Observação de compatibilidade

As mudanças de banco da 2.0 foram construídas de forma aditiva para permitir esse retorno.

A ROUTINE 2.0 não remove tabelas nem colunas da 1.0.

Rotinas arquivadas na 2.0 permanecem fisicamente no banco com `Active = false`. Se houver rollback para a interface 1.0, elas podem aparecer como pausadas, porque a 1.0 não conhece o conceito de arquivamento. Isso não representa perda de dados.


## Proteções do deploy da ROUTINE 2.0

Quando a ROUTINE 2.0 for integrada à `main`, o workflow de produção executará antes do WebDeploy:

1. validação do JavaScript, PWA, Service Worker e manifest;
2. validação estrutural da interface;
3. build Release;
4. testes automatizados das regras de negócio;
5. publish Windows x86;
6. armazenamento do pacote publicado por 30 dias no GitHub Actions.

Depois do WebDeploy, o workflow verifica automaticamente:

`https://routine.runasp.net/health`

O deploy só ficará verde quando a resposta confirmar:

- `version: 2.0`
- `status: ok`
- `database: ready`

A branch `routine-1.0` e o commit `2b1c7beebde588fb13353fa872034904eaeb1f9c` continuam sendo o ponto oficial de rollback.
