---
title: Amazon S3
sidebar_label: Amazon S3
---

# Proveedor Amazon S3

`ValiBlob.AWS` proporciona integración con Amazon S3 y servicios compatibles como MinIO y LocalStack. Soporta autenticación con claves de acceso explícitas, IAM Roles y credenciales temporales STS.

## Instalación

```bash
dotnet add package ValiBlob.AWS
```

## AWSS3Options

```csharp
public class AWSS3Options
{
    public required string BucketName { get; set; }
    public required string Region { get; set; }
    public string? AccessKey { get; set; }           // Omitir para usar IAM Role
    public string? SecretKey { get; set; }           // Omitir para usar IAM Role
    public string? SessionToken { get; set; }        // Para credenciales temporales STS
    public string? ServiceUrl { get; set; }          // Para MinIO, LocalStack, etc.
    public bool ForcePathStyle { get; set; }         // Requerido para MinIO/LocalStack
    public bool UseAccelerateEndpoint { get; set; }  // S3 Transfer Acceleration
    public int TimeoutSeconds { get; set; } = 300;
    public long MultipartThresholdBytes { get; set; } = 5 * 1024 * 1024; // 5 MB
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `BucketName` | — | Nombre del bucket S3. Requerido. |
| `Region` | — | Región AWS (ej. `us-east-1`, `sa-east-1`). Requerido. |
| `AccessKey` | `null` | Clave de acceso. Omitir en producción con IAM Role. |
| `SecretKey` | `null` | Clave secreta. Omitir en producción con IAM Role. |
| `SessionToken` | `null` | Token de sesión para credenciales temporales (STS AssumeRole). |
| `ServiceUrl` | `null` | URL del endpoint alternativo (MinIO, LocalStack). |
| `ForcePathStyle` | `false` | Usar path-style URLs en lugar de virtual-hosted. Requerido para MinIO/LocalStack. |
| `UseAccelerateEndpoint` | `false` | Usar S3 Transfer Acceleration para uploads más rápidos. |
| `MultipartThresholdBytes` | `5 MB` | Archivos mayores a este tamaño usan multipart upload. |

## Configuración básica con credenciales

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "s3")
    .AddProvider<AWSS3Provider>("s3", opts =>
    {
        opts.BucketName = builder.Configuration["AWS:BucketName"]!;
        opts.Region = builder.Configuration["AWS:Region"]!;
        opts.AccessKey = builder.Configuration["AWS:AccessKey"]!;
        opts.SecretKey = builder.Configuration["AWS:SecretKey"]!;
    });
```

## Configuración con IAM Role (recomendado para producción)

En entornos con EC2, ECS, Lambda o IAM Roles, omite `AccessKey` y `SecretKey`. El SDK usa automáticamente las credenciales del entorno (Instance Profile, ECS Task Role, Lambda Execution Role):

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "s3")
    .AddProvider<AWSS3Provider>("s3", opts =>
    {
        opts.BucketName = builder.Configuration["AWS:BucketName"]!;
        opts.Region = "us-east-1";
        // Sin AccessKey ni SecretKey → el SDK usa DefaultAWSCredentials
    });
```

## Política IAM requerida

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ValiBlob",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:HeadObject",
        "s3:ListBucket",
        "s3:CopyObject",
        "s3:PutObjectMetadata"
      ],
      "Resource": [
        "arn:aws:s3:::mi-bucket",
        "arn:aws:s3:::mi-bucket/*"
      ]
    }
  ]
}
```

## Configuración con appsettings y User Secrets

```json
{
  "AWS": {
    "BucketName": "mi-app-produccion",
    "Region": "us-east-1"
  }
}
```

```bash
# Desarrollo local con credenciales explícitas
dotnet user-secrets set "AWS:AccessKey" "AKIAIOSFODNN7EXAMPLE"
dotnet user-secrets set "AWS:SecretKey" "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
```

## LocalStack para desarrollo local

LocalStack emula los servicios AWS (incluyendo S3) en tu máquina:

```yaml
# docker-compose.yml
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=s3
      - DEFAULT_REGION=us-east-1
    volumes:
      - ./scripts-init:/etc/localstack/init/ready.d
```

```bash
# scripts-init/01-crear-bucket.sh
#!/bin/bash
awslocal s3 mb s3://mi-bucket-local
echo "Bucket local creado correctamente"
```

```csharp
// appsettings.Development.json
{
  "AWS": {
    "BucketName": "mi-bucket-local",
    "Region": "us-east-1",
    "AccessKey": "test",
    "SecretKey": "test",
    "ServiceUrl": "http://localhost:4566",
    "ForcePathStyle": true
  }
}
```

```csharp
.AddProvider<AWSS3Provider>("s3", opts =>
{
    opts.BucketName = builder.Configuration["AWS:BucketName"]!;
    opts.Region = builder.Configuration["AWS:Region"]!;

    // Credenciales explícitas solo si están configuradas (LocalStack, desarrollo)
    if (!string.IsNullOrEmpty(builder.Configuration["AWS:AccessKey"]))
    {
        opts.AccessKey = builder.Configuration["AWS:AccessKey"];
        opts.SecretKey = builder.Configuration["AWS:SecretKey"];
        opts.ServiceUrl = builder.Configuration["AWS:ServiceUrl"];
        opts.ForcePathStyle = bool.Parse(
            builder.Configuration["AWS:ForcePathStyle"] ?? "false");
    }
})
```

## URLs prefirmadas (Presigned URLs)

Amazon S3 soporta URLs prefirmadas para acceso temporal a objetos privados:

```csharp
app.MapGet("/api/archivos/{*ruta}/url-firmada", async (
    string ruta,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    if (storage is not IPresignedUrlProvider presigned)
        return Results.StatusCode(501);

    var resultado = await presigned.GetPresignedDownloadUrlAsync(
        path: Uri.UnescapeDataString(ruta),
        expiry: TimeSpan.FromHours(1),
        ct);

    return resultado.IsSuccess
        ? Results.Ok(new
        {
            urlFirmada = resultado.Value,
            expiraEn = DateTime.UtcNow.AddHours(1)
        })
        : Results.NotFound();
}).RequireAuthorization();
```

## Configuración CORS del bucket (para uploads directos desde el navegador)

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedOrigins": ["https://mi-app.com", "http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Ejemplo completo en producción

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "s3")
    .AddProvider<AWSS3Provider>("s3", opts =>
    {
        opts.BucketName = builder.Configuration["AWS:BucketName"]!;
        opts.Region = builder.Configuration["AWS:Region"] ?? "us-east-1";
        // IAM Role en producción: sin credenciales explícitas
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes = 5_000_000_000L; // 5 GB
            v.BlockedExtensions = [".exe", ".bat", ".sh", ".ps1"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.RenameWithSuffix)
    );
```

:::tip Consejo
En producción, usa **IAM Roles** en lugar de claves de acceso estáticas (`AccessKey`/`SecretKey`). Los roles se renuevan automáticamente, no tienen credenciales que rotar manualmente y son el método de autenticación recomendado por AWS. Asigna el rol a tu instancia EC2, tarea ECS o función Lambda.
:::

:::warning Advertencia
Nunca incluyas `AccessKey` y `SecretKey` en el código fuente ni en archivos de configuración versionados. Usa AWS Secrets Manager, Parameter Store o variables de entorno inyectadas por tu plataforma de despliegue. Las claves de acceso expuestas en repositorios públicos son detectadas por bots y pueden generar cargos inesperados en minutos.
:::
