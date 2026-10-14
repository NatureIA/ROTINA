# ROUTINE 2.0 — Criar ambiente de homologação no MonsterASP

Este ambiente deve ser totalmente separado da produção.

## 1. Criar um novo website

No painel do MonsterASP:

1. Abra **Websites**.
2. Clique em **Add website / New website**.
3. Para homologação, escolha um site separado da produção.
4. Use um endereço próprio de staging, por exemplo:
   `routine2-hml.runasp.net`
5. Escolha **My own application** para manter o website vazio.
6. Conclua a criação.

Não usar o website de produção `routine.runasp.net`.

## 2. Criar um banco MSSQL separado

No painel:

1. Abra **Databases**.
2. Clique em **Add database**.
3. Selecione **SQL Server**.
4. Crie um banco exclusivo para homologação.
5. Abra o banco e copie a connection string.

O banco de produção `db71205` não deve ser utilizado no staging.

## 3. Configurar o website de staging

Abra o novo website e acesse:

**Scripting → Environment variables**

Cadastre:

- `ASPNETCORE_ENVIRONMENT=Staging`
- `ConnectionStrings__DefaultConnection=<connection string do banco de staging>`
- `Jwt__Key=<chave exclusiva do staging com pelo menos 32 caracteres>`
- `SeedUsers__User1Login=<usuário de homologação 1>`
- `SeedUsers__User1Password=<senha de homologação 1>`
- `SeedUsers__User2Login=<usuário de homologação 2>`
- `SeedUsers__User2Password=<senha de homologação 2>`

Depois clique em **Restart application**.

Nunca copiar a senha do banco ou a `Jwt__Key` da produção para arquivos do GitHub.

## 4. Ativar WebDeploy no staging

No novo website:

1. Abra **Deploy**.
2. Ative **WebDeploy**.
3. Copie:
   - Site / Website name
   - Server / Computer name
   - Login
   - Password

Esses dados serão usados apenas nos GitHub Secrets de staging.

## 5. Criar os GitHub Secrets de staging

No repositório GitHub, criar:

- `STAGING_WEBSITE_NAME`
- `STAGING_SERVER_COMPUTER_NAME`
- `STAGING_SERVER_USERNAME`
- `STAGING_SERVER_PASSWORD`
- `STAGING_BASE_URL`

Exemplo de `STAGING_BASE_URL`:

`https://routine2-hml.runasp.net`

O workflow possui proteção para impedir que o website ou a URL de produção sejam usados como staging.

## 6. O que acontece automaticamente depois

Quando todos os secrets existirem, o próximo push para `routine-2.0` executará:

1. validação de JavaScript/PWA;
2. validação estrutural da interface;
3. build .NET;
4. testes automatizados de regras de negócio;
5. publish Windows x86;
6. criação de artifact do pacote;
7. WebDeploy somente no staging;
8. verificação automática de `/health`.

Só será considerado saudável se retornar:

```json
{
  "status": "ok",
  "app": "ROUTINE",
  "version": "2.0",
  "database": "ready"
}
```

## 7. Depois do staging subir

Executar o checklist de `ROUTINE_2.0_HOMOLOGACAO.md`.

A produção permanece intacta até aprovação explícita e merge da PR #1.
