# OpenPaint File Cleanup Script
# This script removes backup files, unused files, and empty directories

Write-Host "OpenPaint File Cleanup Script" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Confirm before proceeding
$confirmation = Read-Host "This will delete backup files and unused files. Continue? (y/N)"
if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
    Write-Host "Cleanup cancelled." -ForegroundColor Yellow
    exit
}

$deletedCount = 0
$errorCount = 0

# Function to safely delete a file
function Remove-FileSafely {
    param([string]$FilePath)
    
    if (Test-Path $FilePath) {
        try {
            Remove-Item $FilePath -Force
            Write-Host "  ✓ Deleted: $FilePath" -ForegroundColor Green
            $script:deletedCount++
            return $true
        } catch {
            Write-Host "  ✗ Error deleting $FilePath : $_" -ForegroundColor Red
            $script:errorCount++
            return $false
        }
    } else {
        Write-Host "  ⊘ Not found: $FilePath" -ForegroundColor Gray
        return $false
    }
}

# Function to safely remove empty directory
function Remove-EmptyDirectorySafely {
    param([string]$DirPath)
    
    if (Test-Path $DirPath) {
        try {
            $items = Get-ChildItem $DirPath -Force
            if ($items.Count -eq 0) {
                Remove-Item $DirPath -Force
                Write-Host "  ✓ Removed empty directory: $DirPath" -ForegroundColor Green
                $script:deletedCount++
                return $true
            } else {
                Write-Host "  ⊘ Directory not empty: $DirPath (skipping)" -ForegroundColor Yellow
                return $false
            }
        } catch {
            Write-Host "  ✗ Error removing $DirPath : $_" -ForegroundColor Red
            $script:errorCount++
            return $false
        }
    } else {
        Write-Host "  ⊘ Not found: $DirPath" -ForegroundColor Gray
        return $false
    }
}

Write-Host "Deleting backup files..." -ForegroundColor Yellow
Remove-FileSafely "public\js\paint_backup_corrupted.js"
Remove-FileSafely "public\js\paint_backup.js"
Remove-FileSafely "public\js\paint_final.js"
Remove-FileSafely "public\js\paint_refactored.js"
Remove-FileSafely "public\js\paint_temp.js"
Remove-FileSafely "public\js\paint.js.backup"
Remove-FileSafely "public\js\paint.js.bak"
Remove-FileSafely "public\js\paint.js.fixed"
Remove-FileSafely "public\js\paint.js.new"

Write-Host ""
Write-Host "Deleting debug/temporary files..." -ForegroundColor Yellow
Remove-FileSafely "debug-rotation.js"

Write-Host ""
Write-Host "Deleting unused JavaScript files..." -ForegroundColor Yellow
Remove-FileSafely "public\js\arrow_functions.js"

Write-Host ""
Write-Host "Deleting backup JSON files..." -ForegroundColor Yellow
Remove-FileSafely "tasks\tasks.json.bak"

Write-Host ""
Write-Host "Removing empty directories..." -ForegroundColor Yellow
Remove-EmptyDirectorySafely "backend"
Remove-EmptyDirectorySafely "src"
Remove-EmptyDirectorySafely "tests"
Remove-EmptyDirectorySafely "uploads"

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Cleanup Complete!" -ForegroundColor Cyan
Write-Host "Files deleted: $deletedCount" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "Errors: $errorCount" -ForegroundColor Red
}

