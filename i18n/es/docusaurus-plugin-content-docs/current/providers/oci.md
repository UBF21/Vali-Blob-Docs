---
title: Oracle Cloud Infrastructure
sidebar_label: OCI Object Storage
---

# Proveedor Oracle Cloud Infrastructure

`ValiBlob.OCI` proporciona integración con OCI Object Storage, el servicio de almacenamiento de objetos de Oracle Cloud Infrastructure. Soporta autenticación con claves API de usuario y es compatible con todas las regiones de OCI.

## Instalación

```bash
dotnet add package ValiBlob.OCI
```

## OCIStorageOptions

```csharp
public class OCIStorageOptions
{
    public required string Namespace { get; set; }
    public required string BucketName { get; set; }
    public required string Region { get; set; }
    public required string TenancyId { get; set; }
    public required string UserId { get; set; }
    public required string Fingerprint { get; set; }
    public required string PrivateKey { get; set; }   // Contenido PEM de la clave privada
    public string? PrivateKeyPassphrase { get; set; } // Si la clave está protegida con passphrase
    public int TimeoutSeconds { get; set; } = 300;
}
```

### Tabla de opciones

| Opción | Descripción |
|---|---|
| `Namespace` | Namespace del tenancy en OCI Object Storage |
| `BucketName` | Nombre del bucket de destino |
| `Region` | Identificador de región (ej. `sa-saopaulo-1`) |
| `TenancyId` | OCID del tenancy |
| `UserId` | OCID del usuario con acceso al bucket |
| `Fingerprint` | Fingerprint de la clave API |
| `PrivateKey` | Contenido completo del archivo PEM de la clave privada |
| `PrivateKeyPassphrase` | Passphrase de la clave privada (si aplica) |

## Obtener los valores de configuración

### Paso 1: Obtener el Namespace

```bash
oci os ns get
# Resultado: { "data": "minamespace" }
```

### Paso 2: Crear clave API en OCI Console

1. Ir a **Identity & Security** → **Users** → seleccionar tu usuario
2. Clic en **API Keys** → **Add API Key**
3. Seleccionar **Generate API Key Pair** o subir una clave existente
4. Descargar el archivo de clave privada (`.pem`)
5. Anotar el Fingerprint mostrado

### Paso 3: Obtener los OCIDs

```bash
# OCID del tenancy
oci iam tenancy get --tenancy-id <tenancy-ocid> --query "data.id"

# OCID del usuario actual
oci iam user get --user-id <user-ocid> --query "data.id"
```

## Configuración básica

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "oci")
    .AddProvider<OCIStorageProvider>("oci", opts =>
    {
        opts.Namespace = builder.Configuration["OCI:Namespace"]!;
        opts.BucketName = builder.Configuration["OCI:BucketName"]!;
        opts.Region = builder.Configuration["OCI:Region"]!;
        opts.TenancyId = builder.Configuration["OCI:TenancyId"]!;
        opts.UserId = builder.Configuration["OCI:UserId"]!;
        opts.Fingerprint = builder.Configuration["OCI:Fingerprint"]!;
        opts.PrivateKey = builder.Configuration["OCI:PrivateKey"]!;
    });
```

## Cargar clave privada desde archivo

```csharp
.AddProvider<OCIStorageProvider>("oci", opts =>
{
    opts.Namespace = builder.Configuration["OCI:Namespace"]!;
    opts.BucketName = builder.Configuration["OCI:BucketName"]!;
    opts.Region = "sa-saopaulo-1";
    opts.TenancyId = builder.Configuration["OCI:TenancyId"]!;
    opts.UserId = builder.Configuration["OCI:UserId"]!;
    opts.Fingerprint = builder.Configuration["OCI:Fingerprint"]!;

    // Cargar la clave desde archivo (montado como secreto en producción)
    var claveRuta = builder.Configuration["OCI:PrivateKeyPath"]!;
    opts.PrivateKey = File.ReadAllText(claveRuta);
})
```

## Configuración en appsettings.json

```json
{
  "OCI": {
    "Namespace": "minamespace",
    "BucketName": "mi-bucket-produccion",
    "Region": "sa-saopaulo-1",
    "TenancyId": "ocid1.tenancy.oc1..xxxxx",
    "UserId": "ocid1.user.oc1..xxxxx",
    "Fingerprint": "aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99",
    "PrivateKeyPath": "/run/secrets/oci-api-key.pem"
  }
}
```

## Políticas IAM en OCI

```
# Política a nivel de compartimento
Allow group StorageUsers to manage objects in compartment MiCompartimento
  where target.bucket.name='mi-bucket'

Allow group StorageUsers to manage buckets in compartment MiCompartimento
  where target.bucket.name='mi-bucket'
```

## Regiones disponibles

| Región | Identificador |
|---|---|
| São Paulo, Brasil | `sa-saopaulo-1` |
| Vinhedo, Brasil | `sa-vinhedo-1` |
| Phoenix, AZ, EEUU | `us-phoenix-1` |
| Ashburn, VA, EEUU | `us-ashburn-1` |
| Frankfurt, Alemania | `eu-frankfurt-1` |
| Ámsterdam, Países Bajos | `eu-amsterdam-1` |
| Londres, Reino Unido | `uk-london-1` |
| Tokio, Japón | `ap-tokyo-1` |
| Seúl, Corea del Sur | `ap-seoul-1` |
| Mumbai, India | `ap-mumbai-1` |
| Sídney, Australia | `ap-sydney-1` |

## Configuración con User Secrets para desarrollo

```bash
dotnet user-secrets set "OCI:Namespace" "minamespace"
dotnet user-secrets set "OCI:BucketName" "dev-bucket"
dotnet user-secrets set "OCI:Region" "sa-saopaulo-1"
dotnet user-secrets set "OCI:TenancyId" "ocid1.tenancy.oc1..xxxxx"
dotnet user-secrets set "OCI:UserId" "ocid1.user.oc1..xxxxx"
dotnet user-secrets set "OCI:Fingerprint" "aa:bb:cc:..."
dotnet user-secrets set "OCI:PrivateKey" "$(cat ~/.oci/oci_api_key.pem)"
```

## Ejemplo completo

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "oci")
    .AddProvider<OCIStorageProvider>("oci", opts =>
    {
        var ociConfig = builder.Configuration.GetSection("OCI");

        opts.Namespace = ociConfig["Namespace"]!;
        opts.BucketName = ociConfig["BucketName"]!;
        opts.Region = ociConfig["Region"]!;
        opts.TenancyId = ociConfig["TenancyId"]!;
        opts.UserId = ociConfig["UserId"]!;
        opts.Fingerprint = ociConfig["Fingerprint"]!;

        // Prioridad: archivo en disco → inline en configuración
        var claveRuta = ociConfig["PrivateKeyPath"];
        var claveInline = ociConfig["PrivateKey"];

        opts.PrivateKey = !string.IsNullOrEmpty(claveRuta) && File.Exists(claveRuta)
            ? File.ReadAllText(claveRuta)
            : claveInline!;
    })
    .WithPipeline(p => p
        .UseValidation(v => v.MaxFileSizeBytes = 1_000_000_000L) // 1 GB
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    );
```

:::tip Consejo
En entornos de Kubernetes en OCI, usa **Instance Principals** o **Resource Principals** en lugar de claves API de usuario. Esto elimina la necesidad de gestionar archivos de clave privada en los pods y es más seguro para operaciones de producción.
:::

:::warning Advertencia
La clave privada RSA es una credencial extremadamente sensible. Nunca la incluyas en el código fuente, en imágenes de Docker ni en archivos de configuración versionados. Usa OCI Vault, Kubernetes Secrets o un gestor de secretos externo para almacenarla de forma segura en producción.
:::
