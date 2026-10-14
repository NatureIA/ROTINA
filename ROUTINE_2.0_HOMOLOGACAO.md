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


## Ambiente de staging

Existe um workflow separado chamado **Deploy ROUTINE 2.0 to Staging**.

Regras de segurança:

- reage somente à branch `routine-2.0` e também mantém opção de execução manual quando disponível;
- enquanto os secrets `STAGING_*` não estiverem configurados, o workflow termina em modo seguro sem fazer deploy;
- depois que o staging for configurado, cada atualização da `routine-2.0` é validada e publicada automaticamente somente no staging;
- usa exclusivamente secrets com prefixo `STAGING_`;
- bloqueia o deploy se `STAGING_WEBSITE_NAME` for igual ao `WEBSITE_NAME` da produção;
- executa validação do frontend, testes .NET e publish antes do WebDeploy;
- salva o pacote publicado por 7 dias como artifact de homologação;
- não altera o workflow de produção da `main`.

Secrets necessários quando o site de homologação for criado:

- `STAGING_WEBSITE_NAME`
- `STAGING_SERVER_COMPUTER_NAME`
- `STAGING_SERVER_USERNAME`
- `STAGING_SERVER_PASSWORD`
- `STAGING_BASE_URL` (ex.: `https://routine2-seu-site.runasp.net`)

Isso permite manter a `main` completamente intocada durante toda a homologação.

O site de staging também deve possuir suas próprias configurações de ambiente:

- `ConnectionStrings__DefaultConnection` apontando para banco de homologação;
- `Jwt__Key`;
- `SeedUsers__User1Login` / `SeedUsers__User1Password`;
- `SeedUsers__User2Login` / `SeedUsers__User2Password`.

O banco de homologação deve ser separado do banco de produção. Nunca usar `db71205` para testes destrutivos ou de homologação da 2.0.

O deploy de staging só é considerado concluído quando `STAGING_BASE_URL/health` responder simultaneamente:

- `version: 2.0`
- `status: ok`
- `database: ready`

O workflow tenta essa verificação automaticamente por até aproximadamente 1 minuto após o WebDeploy.
