# ROUTINE 3.4 — diagnóstico do botão Testar Webhook

## O que ocorreu em 21/10/2026

A Kiwify enviou dois POSTs para o endpoint e o IIS registrou HTTP 200.
Consulta realizada pelo usuário no banco SQL Server:
- KiwifyWebhookReceipts: 0
- KiwifyEntitlements: 0
- Users com KiwifyManaged=1: 0

Isso **não** prova falha: o endpoint responde `200 { status: "ignored_product" }` quando `Product.product_id` difere do produto configurado. A documentação da Kiwify informa que o teste usa dados fictícios. Um ID de exemplo é esperado, mas precisa ser observado.

## Diagnóstico seguro acrescentado

`KiwifyWebhookDiagnostics` registra **somente**:
- Outcome: `ignored_product`, `ignored_non_purchase_event` ou `ignored_subscription`
- EventType: tipo do evento
- ProductId: ID do produto informado no teste
- ReceivedAtUtc: horário de recebimento

A persistência é feita **somente depois da validação da assinatura HMAC**, sem salvar nome, e-mail, corpo, assinatura ou token. Nenhuma conta é criada por causa do diagnóstico; não enfraquecer a exigência de ID real do produto.

Consulta somente leitura em MonsterASP.NET → Databases → Run T-SQL:

```sql
SELECT TOP (10)
    ReceivedAtUtc, Outcome, EventType, ProductId
FROM dbo.KiwifyWebhookDiagnostics
ORDER BY ReceivedAtUtc DESC;
```

Enviar um novo `Testar Webhook` da Kiwify com `Compra aprovada`, consultar a tabela e identificar o desvio. Esse teste é fictício e, quando o ID de produto não corresponder, **não criará usuários** (funcionamento deliberado). Não inventar nem gravar uma compra na produção para simular uma venda.

## Validação da criação de usuário sem compra real

O conjunto de testes automáticos envia um POST assinado com o ID exato do ROUTINE (injetando token sintético e SQL isolado em memória). Verifica: criação de conta, permissão, data de vencimento, idempotência e preservação das contas existentes. Esse teste valida a regra de negócio, **não** autentica uma entrega real da Kiwify. Uma compra real será necessária para a homologação comercial ponta a ponta. Não alegar que a integração foi homologada até esse ponto.

## Implantação

Migração do diagnóstico usa `CREATE TABLE IF NOT EXISTS` com checagem via `OBJECT_ID`, criando só tabela e índice novos. Sem `UPDATE`/`DELETE` nas contas. Preservar contas legadas e integração HMAC existente.
