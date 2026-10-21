# ROUTINE 3.4 — Kiwify, compra única e acessos

## Produto e regras aprovadas

- Produto: Routine — Organizador de Rotinas e Hábitos
- Produto Kiwify ID: `b537da80-c888-11f1-b0f5-37ff8e851a7d`
- Cobrança: COMPRA ÚNICA, sem renovação automática ou assinatura recorrente.
- Conta do comprador: criada quando chegar confirmação autenticada do pagamento.
- Acesso inicial: imediato; os 7 primeiros dias inteiros não consomem a anuidade.
- Vigência: a partir do 8º dia contam-se 12 meses de calendário, conservando hora/minuto/segundo.
- Quando expirar: bloquear automaticamente login **e** autenticação JWT; preservar dados e histórico.
- Recompra com o mesmo e-mail normalizado: reutilizar conta existente e adicionar 12 meses ao prazo ainda válido. Se já vencido, contar 12 meses da nova compra, sem novo bônus inicial de 7 dias.
- Mesmo pedido/reenvio de webhook: idempotente, sem adicionar tempo.
- Reembolso ou chargeback: revogar apenas a compra correspondente, com preservação da auditoria.

## Exceção permanente aprovada

**João, Victor, Jeferson e Lara**, contas já presentes na produção antes da publicação da versão 3.4, não estão sujeitos a limites comerciais. **Nunca suspender essas contas por ausência de compra/recompra**. Não localizar esses usuários apenas por `DisplayName` ou por e-mail codificado. Identificar pela condição persistida no SQL: `Users.KiwifyManaged = 0`, que é o valor de todas as contas preexistentes ao rollout. Esse valor não é redefinido pelo recebimento de uma compra referente a uma conta legada.

Somente contas **novas**, criadas diretamente pela integração, recebem `Users.KiwifyManaged = 1`. Se um comprador já possuir uma conta antiga, registrar o pedido na mesma conta sem aplicar vencimento à conta antiga. Não atualizar `KiwifyManaged` automaticamente para `1` em usuários existentes.

**Não deletar usuários, dados ou históricos ao vencer.**

## Configuração de segurança e implantação (não está ativo ainda)

- `Kiwify__ProductId` = `b537da80-c888-11f1-b0f5-37ff8e851a7d`
- `Kiwify__InitialDays` = `7`
- `Kiwify__OneTimeAccessMonths` = `12`
- `Kiwify__WebhookToken` = segredo **novo**, criado na Kiwify. Nunca publicar no repositório, capturas ou conversas.
- `Kiwify__Enabled` = `false` até concluir homologação e revisão da ativação.
- Endpoint futuro: `POST https://routine.runasp.net/api/integrations/kiwify/webhook`
- Na Kiwify: selecionar **somente** o produto exato, com eventos **Compra aprovada**, **Reembolso** e **Chargeback**.
- Não selecionar eventos de assinatura, pois o produto não é recorrente.
- Não fazer merge em `main` e não habilitar Kiwify enquanto não forem checados formato/assinatura de notificação real, conflitos de dados e callbacks de rejeição.
- Todas as evoluções devem ocorrer apenas em `routine-3.4`; preservar 3.3, demais branches e SQL existente.

## Rotina de validação

1. Confirmar compilação e testes na branch isolada.
2. Conferir em produção, **sem modificar as contas**, que os quatro usuários nomeados persistem e têm `KiwifyManaged=0` após migração aditiva.
3. Enviar evento de homologação assinado em ambiente controlado, antes de receber notificações comerciais.
4. Validar compra, recompra (antecipada/vencida), reembolso, retry, troca de senha e JWT antigo.
5. Concluir configuração das variáveis secretas no host e acompanhar logs da Kiwify.
6. Apenas após validação explícita, submeter PR de produção e verificar `/health`.
