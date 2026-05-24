# syntax=docker/dockerfile:1.7
# Single image that builds the Vite frontend, builds the .NET API,
# and serves both from one container. The SPA is copied into wwwroot
# and falls back to index.html so the React Router handles client routes.

# ---- Frontend build ---------------------------------------------------------
FROM node:20-alpine AS web-build
WORKDIR /src
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- API build --------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /src
COPY api/MountedGames.Api.csproj ./
RUN dotnet restore
COPY api/ ./
RUN dotnet publish -c Release -o /out /p:UseAppHost=false

# ---- Runtime ----------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=api-build /out ./
# Drop the built SPA into wwwroot so UseStaticFiles + MapFallbackToFile pick it up
COPY --from=web-build /src/dist ./wwwroot/

ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080

ENTRYPOINT ["dotnet", "MountedGames.Api.dll"]
