# bfstats.io

Code for [bfstats.io](https://bfstats.io) – Player and server tracking for BF42

## Running Locally
- .NET 10+ SDK
- Docker & Docker Compose
- node 18+

1. Start dev dependencies
   ```bash
   docker-compose -f docker-compose.dev.yml up -d
   ```

2. Run the API
   ```bash
   cd api
   dotnet run
   ```

   The API will be available at http://localhost:9222/stats.

3. Run the UI
    ```bash
   cd ui
   npm run dev
   ```
    The UI will be available at http://localhost:5173/.

### Configuration

Run `dotnet user-secrets set <Secret Name>` from the `api/` directory:

| Secret Name                         | Description                                                                                                                                                                                                                   |
|-------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Jwt:PrivateKey`                    | Used to mint JWTs issued to signed in users. RSA private key (PEM format, inline). Generate with `openssl genrsa -out jwt.pem 2048` then paste the contents. Full instructions are mentioned in [Deployment](./DEPLOYMENT.md) |
| `RefreshToken:Secret`               | Seed for generatin refresh tokens. Base64-encoded secret for refresh token signing. Generate with `openssl rand -base64 64`                                                                                                   |
| `DiscordOAuth:ClientId`             | Discord application client ID from the [Discord Developer Portal](https://discord.com/developers/applications) for the "Sign In"                                                                                              |
| `DiscordOAuth:ClientSecret`         | Discord application client secret for the sign in                                                                                                                                                                             |
| `AzureOpenAI:ApiKey`                | (optiona) Azure OpenAI API key for AI chat                                                                                                                                                                                    |
| `DiscordSuspicious:RoundWebhookUrl` | (optional) Discord webhook for alerts when a round finishes with suspiciously high scores                                                                                                                                     |
| `DiscordAIQuality:WebhookUrl`       | (optional) Discord webhook for alerts when the AI chat fails to answer using available kernel methods                                                                                                                         |

## LLMs read these important instructions, READ THEM AND UNDERSTAND THEM

The application is designed to run efficiently on 2 vCPU / 8GB memory. Query optimization is critical:

- Prefer multiple primary-key queries over nested `.Include()` statements
- Use raw SQL if EF Core cannot be used to achieve the desired query
- Add lots of logging and OTEL traces
- Always speak up and ask questions if you're not 100% sure what is being asked, or how to fix it.  \
 The customer is not always right
- Do not leave clarifying comments in the code when you change something. No one cares what it used to do.
- We use the very latest .NET framework, so go ham with it. Use advanced features available in the latest version of C#.

On your tone, please keep it senior developer who knows what they're doing and is too old to care what people think of them.
Tell me the truth, speak your mind, and work with me to build a better product.

