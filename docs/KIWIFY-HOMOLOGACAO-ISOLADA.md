# Homologação isolada ROUTINE 3.4 — Kiwify

Este conjunto de testes **não acessa** o SQL Server da MonsterASP.NET, não faz compra e não envia e-mails reais.

## Abrangência

- O teste usa SQLite relacional em memória com as entidades reais do EF Core.
- Payload de compra única estruturado segundo a documentação Kiwify (sem dados privados).
- Assinatura HMAC-SHA1 com token fictício de testes.
- Confirma criação de usuário e de registro de compra no banco relacional temporário.
- Confirma validade de 7 dias iniciais + 12 meses de calendário, segundo `ReceivedAtUtc`.
- Confirma envio simulado de boas-vindas e geração de link de recuperação; nova senha criada, login realizado.
- Confirma rejeição do reuso do token de redefinição.
- Confirma idempotência do webhook.
- Confirma recompra antecipada, bloqueio por vencimento, nova compra após vencimento, e reembolso.
- Confirma que João, Victor, Jeferson e Lara permanecem com acesso sem expiração ao receber compra/reembolso.
- Confirma que outro ID de produto jamais cria usuário.

## O que este teste NÃO prova

- Não testa o SQL Server hospedado na MonsterASP.NET nem as migrações reais de produção.
- Não comprova entrega de e-mail pelo SMTP Hostinger.
- Não comprova a assinatura gerada pela Kiwify no ambiente de produção (usa o algoritmo documentado e um segredo sintético).
- Não comprova recebimento de uma compra real aprovada do produto ROUTINE.

A validação técnica deverá ser separada da homologação comercial. **Não habilitar casos de compra fictícia na base real somente para forçar o teste.**