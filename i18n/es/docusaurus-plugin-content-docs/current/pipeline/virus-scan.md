---
title: Análisis de Virus
sidebar_label: Análisis de Virus
---

# Análisis de Virus

El `VirusScanMiddleware` escanea el contenido de los archivos antes de almacenarlos. Si se detecta malware, la subida se cancela, se retorna `StorageErrorCode.VirusDetected` y se publica un evento `VirusDetectedEvent`. ValiBlob no incluye un motor de antivirus — debes proveer tu propia implementación de `IVirusScanner`.

## Activación

```csharp
.WithPipeline(p => p
    .UseVirusScan(v =>
    {
        v.FailOnScanError = true;  // Rechazar si el escáner no está disponible
        v.TimeoutSeconds = 30;     // Tiempo máximo de espera
        v.SkipOnSize = 0;          // 0 = escanear todos sin importar el tamaño
    })
)
```

## VirusScanOptions

```csharp
public class VirusScanOptions
{
    /// <summary>Si true, rechaza la subida cuando el escáner falla (no disponible, timeout, etc.). Por defecto: true.</summary>
    public bool FailOnScanError { get; set; } = true;

    /// <summary>Tiempo máximo en segundos para el análisis. Por defecto: 30.</summary>
    public int TimeoutSeconds { get; set; } = 30;

    /// <summary>Omitir análisis para archivos mayores a este tamaño en bytes. 0 = sin límite.</summary>
    public long SkipOnSize { get; set; } = 0;
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `FailOnScanError` | `true` | Rechazar la subida si el escáner no responde o falla |
| `TimeoutSeconds` | `30` | Timeout para el análisis. Pasado el tiempo, se considera fallo |
| `SkipOnSize` | `0` | Tamaño máximo a escanear (bytes). Archivos más grandes se omiten. `0` = sin límite |

## IVirusScanner

Implementa esta interfaz con el escáner de tu elección:

```csharp
public interface IVirusScanner
{
    Task<VirusScanResult> ScanAsync(Stream content, string? fileName, CancellationToken ct = default);
}

public class VirusScanResult
{
    public bool IsClean { get; init; }
    public bool IsInfected => !IsClean && ThreatName is not null;
    public bool ScanFailed { get; init; }
    public string? ThreatName { get; init; }
    public string? Details { get; init; }

    public static VirusScanResult Clean() => new() { IsClean = true };

    public static VirusScanResult Infected(string threatName, string? details = null)
        => new() { IsClean = false, ThreatName = threatName, Details = details };

    public static VirusScanResult Failed(string details)
        => new() { IsClean = false, ScanFailed = true, Details = details };
}
```

## Implementación con ClamAV (recomendado)

ClamAV es un antivirus de código abierto gratuito que puede ejecutarse como daemon local o en Docker.

```yaml
# docker-compose.yml
services:
  clamav:
    image: clamav/clamav:latest
    ports:
      - "3310:3310"
    volumes:
      - clamav-datos:/var/lib/clamav
```

```bash
dotnet add package nClam
```

```csharp
using nClam;

public class ClamAvScanner(
    IOptions<ClamAvOptions> opciones,
    ILogger<ClamAvScanner> logger) : IVirusScanner
{
    private readonly ClamClient _cliente = new(opciones.Value.Host, opciones.Value.Puerto);

    public async Task<VirusScanResult> ScanAsync(Stream contenido, string? nombreArchivo, CancellationToken ct)
    {
        try
        {
            var resultado = await _cliente.SendAndScanFileAsync(contenido, ct);

            return resultado.Result switch
            {
                ClamScanResults.Clean => VirusScanResult.Clean(),

                ClamScanResults.VirusDetected => VirusScanResult.Infected(
                    threatName: resultado.InfectedFiles?.FirstOrDefault()?.VirusName ?? "Amenaza desconocida",
                    details: $"Archivo: {nombreArchivo}"),

                ClamScanResults.Error => VirusScanResult.Failed(resultado.RawResult),

                _ => VirusScanResult.Failed("Resultado desconocido del escáner")
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error al conectar con ClamAV en {Host}:{Puerto}",
                opciones.Value.Host, opciones.Value.Puerto);
            return VirusScanResult.Failed($"Error de conexión con ClamAV: {ex.Message}");
        }
    }
}

public class ClamAvOptions
{
    public string Host { get; set; } = "localhost";
    public int Puerto { get; set; } = 3310;
}

// Registro en DI
builder.Services.Configure<ClamAvOptions>(builder.Configuration.GetSection("ClamAV"));
builder.Services.AddScoped<IVirusScanner, ClamAvScanner>();
```

## Implementación con VirusTotal API

```csharp
public class VirusTotalScanner(
    IOptions<VirusTotalOptions> opciones,
    HttpClient httpClient,
    ILogger<VirusTotalScanner> logger) : IVirusScanner
{
    public async Task<VirusScanResult> ScanAsync(Stream contenido, string? nombreArchivo, CancellationToken ct)
    {
        try
        {
            httpClient.DefaultRequestHeaders.TryAddWithoutValidation("x-apikey", opciones.Value.ApiKey);

            // 1. Subir el archivo a VirusTotal
            using var formulario = new MultipartFormDataContent();
            formulario.Add(new StreamContent(contenido), "file", nombreArchivo ?? "archivo");

            var respuestaSubida = await httpClient.PostAsync(
                "https://www.virustotal.com/api/v3/files", formulario, ct);

            if (!respuestaSubida.IsSuccessStatusCode)
                return VirusScanResult.Failed($"Error al subir a VirusTotal: {respuestaSubida.StatusCode}");

            var respuestaJson = await respuestaSubida.Content.ReadFromJsonAsync<VirusTotalSubidaResponse>(ct);
            var analysisId = respuestaJson!.Data.Id;

            // 2. Polling hasta que el análisis esté listo
            for (int intento = 0; intento < 10; intento++)
            {
                await Task.Delay(3000, ct);

                var respuestaAnalisis = await httpClient.GetFromJsonAsync<VirusTotalAnalisisResponse>(
                    $"https://www.virustotal.com/api/v3/analyses/{analysisId}", ct);

                if (respuestaAnalisis?.Data.Attributes.Status == "completed")
                {
                    var estadisticas = respuestaAnalisis.Data.Attributes.Stats;
                    return estadisticas.Malicious > 0
                        ? VirusScanResult.Infected(
                            $"{estadisticas.Malicious} motores detectaron malware",
                            $"Sospechosos: {estadisticas.Suspicious}")
                        : VirusScanResult.Clean();
                }
            }

            return VirusScanResult.Failed("Timeout esperando análisis de VirusTotal");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error al llamar a VirusTotal API");
            return VirusScanResult.Failed(ex.Message);
        }
    }
}

// Registro
builder.Services.AddHttpClient<IVirusScanner, VirusTotalScanner>();
builder.Services.Configure<VirusTotalOptions>(builder.Configuration.GetSection("VirusTotal"));
```

## Mock para desarrollo y pruebas

```csharp
public class MockVirusScanner : IVirusScanner
{
    public Task<VirusScanResult> ScanAsync(Stream content, string? fileName, CancellationToken ct)
        => Task.FromResult(VirusScanResult.Clean());
}

// Registro condicional por entorno
if (builder.Environment.IsDevelopment())
    builder.Services.AddScoped<IVirusScanner, MockVirusScanner>();
else
    builder.Services.AddScoped<IVirusScanner, ClamAvScanner>();
```

## Manejar el resultado de virus detectado

```csharp
var resultado = await storage.UploadAsync(request, ct);

if (!resultado.IsSuccess && resultado.ErrorCode == StorageErrorCode.VirusDetected)
{
    // Registrar el intento para auditoría de seguridad
    logger.LogWarning(
        "Subida bloqueada por virus. Path={Path}, Mensaje={Mensaje}",
        request.Path,
        resultado.ErrorMessage);

    return Results.UnprocessableEntity(new
    {
        error = "VIRUS_DETECTADO",
        mensaje = "El archivo contiene contenido malicioso y no puede ser almacenado."
    });
}
```

## Evento de virus detectado

```csharp
public class ManejadorVirusDetectado : IStorageEventHandler<VirusDetectedEvent>
{
    private readonly IAlertaServicio _alertas;

    public async Task HandleAsync(VirusDetectedEvent evento, CancellationToken ct)
    {
        // Enviar alerta al equipo de seguridad
        await _alertas.EnviarAsync(new Alerta
        {
            Titulo = "Intento de subida de malware bloqueado",
            Cuerpo = $"Amenaza: {evento.ThreatName}\nArchivo: {evento.Path}\nFecha: {DateTime.UtcNow:u}",
            Severidad = SeveridadAlerta.Alta
        }, ct);
    }
}

// Registro del manejador
builder.Services.AddScoped<IStorageEventHandler<VirusDetectedEvent>, ManejadorVirusDetectado>();
```

:::warning Advertencia
El análisis de virus **no reemplaza** otras capas de seguridad. Combínalo siempre con `UseContentTypeDetection` (para detectar ejecutables disfrazados), `UseValidation` con listas negras de extensiones, y principio de mínimo privilegio en el bucket. Los antivirus solo detectan amenazas conocidas — malware nuevo o polimórfico puede evadir la detección.
:::

:::tip Consejo
ClamAV es la opción recomendada para entornos auto-gestionados. Para startups o proyectos sin infraestructura propia, VirusTotal ofrece un plan gratuito con 4 análisis por minuto. En ambos casos, considera el impacto en la latencia de subida: un análisis típico tarda entre 1 y 10 segundos, lo que puede afectar la experiencia del usuario para subidas interactivas.
:::
