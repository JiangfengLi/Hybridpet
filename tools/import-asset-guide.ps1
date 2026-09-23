param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$environmentNames = @{
    'p01_shrub_small' = 'bush-01'
    'p02_shrub_large' = 'bush-02'
    'e05_grass_mid' = 'grass-01'
    'e06_grass_tall' = 'grass-02'
    'b01_dome' = 'camp-dome'
    'b02_cube' = 'camp-cube'
    'b03_door' = 'camp-door'
    'b04_fence' = 'camp-fence'
    'b05_lamp' = 'camp-lamp'
    'b06_sign' = 'camp-sign'
    'b07_energy' = 'camp-energy'
}
$pending = [Collections.Generic.List[object]]::new()
$outer = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath))
try {
    foreach ($pack in @('environment', 'pets')) {
        $nested = $outer.GetEntry("AssetPack_$pack.zip")
        if (!$nested) { throw "Missing AssetPack_$pack.zip" }
        $memory = [IO.MemoryStream]::new()
        $stream = $nested.Open()
        try { $stream.CopyTo($memory) } finally { $stream.Dispose() }
        $memory.Position = 0
        $zip = [IO.Compression.ZipArchive]::new($memory)
        try {
            $manifestEntry = $zip.GetEntry("$pack/$pack.json")
            $reader = [IO.StreamReader]::new($manifestEntry.Open())
            try { $manifestText = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $manifest = $manifestText | ConvertFrom-Json
            $assets = if ($pack -eq 'environment') {
                @($manifest.assets | Where-Object { $_.file })
            } else {
                @($manifest.pets) + @($manifest.variants)
            }
            $pending.Add([pscustomobject]@{
                Target = "docs/asset-guide/$pack.json"
                Bytes = [Text.UTF8Encoding]::new($false).GetBytes($manifestText)
                Source = "$pack/$pack.json"
            })
            foreach ($asset in $assets) {
                $entry = $zip.GetEntry("$pack/$($asset.file)")
                if (!$entry) { throw "Missing $pack/$($asset.file)" }
                $name = [IO.Path]::GetFileNameWithoutExtension($asset.file)
                if ($pack -eq 'environment') {
                    $targetName = if ($environmentNames.ContainsKey($name)) {
                        $environmentNames[$name]
                    } else { "environment-$name" }
                    $target = "models/$targetName.glb"
                } elseif ($asset.file.StartsWith('variants/')) {
                    $target = "models/variants/$name.glb"
                } else {
                    $target = "models/$($asset.key).glb"
                }
                $bytes = [IO.MemoryStream]::new()
                $stream = $entry.Open()
                try { $stream.CopyTo($bytes) } finally { $stream.Dispose() }
                $data = $bytes.ToArray()
                $bytes.Dispose()
                if ($data.Length -lt 20 -or [Text.Encoding]::ASCII.GetString($data, 0, 4) -ne 'glTF' -or
                    [BitConverter]::ToUInt32($data, 4) -ne 2 -or
                    [BitConverter]::ToUInt32($data, 8) -ne $data.Length) {
                    throw "Invalid GLB: $($entry.FullName)"
                }
                $pending.Add([pscustomobject]@{ Target = $target; Bytes = $data; Source = $entry.FullName })
            }
        } finally {
            $zip.Dispose()
            $memory.Dispose()
        }
    }
} finally { $outer.Dispose() }

# Validate every destination before replacing any existing asset.
foreach ($item in $pending) {
    $destination = [IO.Path]::GetFullPath((Join-Path $root $item.Target))
    if (!$destination.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Asset destination escapes project: $destination"
    }
}
$hash = [Security.Cryptography.SHA256]::Create()
try {
    $records = foreach ($item in $pending) {
        $destination = Join-Path $root $item.Target
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
        [IO.File]::WriteAllBytes($destination, $item.Bytes)
        [ordered]@{
            source = $item.Source
            target = $item.Target
            sha256 = [BitConverter]::ToString($hash.ComputeHash($item.Bytes)).Replace('-', '').ToLowerInvariant()
        }
        Write-Host "$($item.Source) -> $($item.Target)"
    }
    $recordJson = ConvertTo-Json -InputObject @($records) -Depth 4
    [IO.File]::WriteAllText((Join-Path $root 'docs/asset-guide/import-map.json'), $recordJson, [Text.UTF8Encoding]::new($false))
} finally { $hash.Dispose() }
