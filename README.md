# ROUTINE

Painel pessoal de gestão de rotina com dois acessos independentes, ASP.NET Core 8 e MSSQL.

## MonsterASP
Crie um Website .NET 8 e um banco MSSQL.

No Website, configure estas variáveis de ambiente:
- `ConnectionStrings__DefaultConnection`
- `Jwt__Key` (mínimo 32 caracteres)
- `SeedUsers__User1Login`
- `SeedUsers__User1Password`
- `SeedUsers__User2Login`
- `SeedUsers__User2Password`

Na primeira inicialização o sistema cria automaticamente as tabelas e os dois usuários.

## GitHub Actions
Ative WebDeploy no MonsterASP e crie estes Secrets no GitHub:
- `WEBSITE_NAME`
- `SERVER_COMPUTER_NAME`
- `SERVER_USERNAME`
- `SERVER_PASSWORD`

Qualquer push na branch main dispara build + publicação + deploy.

Nenhuma senha, JWT key ou connection string deve ser salva no repositório.
