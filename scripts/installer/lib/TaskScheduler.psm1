#Requires -Version 5.1
<#
.SYNOPSIS
    ManLab Agent Installer - Task Scheduler Module
.DESCRIPTION
    Handles Windows Task Scheduler service installation and management.
#>

$script:TaskName = "ManLab Agent"
$script:TaskNameUser = "ManLab Agent User"

#region Task Management

function Get-AgentScheduledTask {
    param([string]$Name = $script:TaskName)
    
    try {
        return Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    } catch {
        return $null
    }
}

function New-AgentSystemTask {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$RunnerPath
    )
    
    Write-Info "Creating system scheduled task: $Name"
    
    if ($script:DryRun) {
        Write-Info "[DRY RUN] Would create task: $Name"
        return $true
    }
    
    $psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunnerPath`""
    
    try {
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
        
        Register-ScheduledTask -TaskName $Name -InputObject $task -Force | Out-Null
        Write-Info "Task created: $Name"
        return $true
    } catch {
        Write-Err "Failed to create task: $($_.Exception.Message)"
        return $false
    }
}

function New-AgentUserTask {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$RunnerPath
    )
    
    Write-Info "Creating user scheduled task: $Name"
    
    if ($script:DryRun) {
        Write-Info "[DRY RUN] Would create user task: $Name"
        return $true
    }
    
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunnerPath`""
    
    try {
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
        $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType InteractiveToken -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
        $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
        
        Register-ScheduledTask -TaskName $Name -InputObject $task -Force | Out-Null
        Write-Info "User task created: $Name"
        return $true
    } catch {
        Write-Warn "Task creation blocked, using registry fallback"
        Set-UserAutostart -Name $Name -CommandLine "powershell.exe $psArgs"
        return $true
    }
}

function Stop-AgentProcesses {
    <#
    .SYNOPSIS
        Kill all running agent processes and wait for termination.
    .DESCRIPTION
        Finds all manlab-agent.exe processes, terminates them, and waits
        for file handles to be released before returning.
    #>
    [CmdletBinding()]
    param(
        [int]$TimeoutSeconds = 10
    )
    
    Write-Info "Stopping any running agent processes..."
    
    if ($script:DryRun) {
        Write-Info "[DRY RUN] Would stop agent processes"
        return
    }
    
    # Kill all manlab-agent.exe processes
    $processes = Get-Process -Name "manlab-agent" -ErrorAction SilentlyContinue
    if ($processes) {
        foreach ($proc in $processes) {
            Write-Debug "  Terminating process $($proc.Id)..."
            $proc | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        
        # Wait for processes to fully terminate
        $waited = 0
        while ($waited -lt $TimeoutSeconds) {
            $remaining = Get-Process -Name "manlab-agent" -ErrorAction SilentlyContinue
            if (-not $remaining) { break }
            Start-Sleep -Seconds 1
            $waited++
        }
        
        if ($waited -gt 0) {
            Write-Debug "Waited ${waited}s for agent processes to terminate"
        }
    } else {
        Write-Debug "No agent processes found"
    }
}

function Remove-AgentTask {
    <#
    .SYNOPSIS
        Removes a scheduled task and stops any running agent processes.
    .DESCRIPTION
        Stops the scheduled task, terminates agent processes, and then
        unregisters the task from Task Scheduler.
    #>
    [CmdletBinding()]
    param([string]$Name = $script:TaskName)
    
    Write-Info "Removing scheduled task: $Name"
    
    if ($script:DryRun) {
        Write-Info "[DRY RUN] Would remove task: $Name"
        return
    }
    
    $task = Get-AgentScheduledTask -Name $Name
    if ($null -eq $task) {
        Write-Debug "Task not found: $Name"
        return
    }
    
    # Stop the scheduled task first
    if ($task.State -eq 'Running') {
        Write-Debug "Stopping running task: $Name"
        try {
            Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        } catch { }
    }
    
    # Stop any running agent processes
    Stop-AgentProcesses
    
    # Unregister the task
    try {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop
        Write-Debug "Task removed: $Name"
    } catch {
        Write-Warn "Failed to remove task: $($_.Exception.Message)"
    }
}

function Start-AgentTask {
    param([string]$Name = $script:TaskName)
    
    Write-Info "Starting scheduled task: $Name"
    
    if ($script:DryRun) {
        Write-Info "[DRY RUN] Would start task: $Name"
        return $true
    }
    
    try {
        Start-ScheduledTask -TaskName $Name -ErrorAction Stop
        return $true
    } catch {
        Write-Warn "Failed to start task: $($_.Exception.Message)"
        return $false
    }
}

function Get-AgentTaskStatus {
    param([string]$Name = $script:TaskName)
    
    $task = Get-AgentScheduledTask -Name $Name
    if ($null -eq $task) { return "not-installed" }
    
    if ($task.State -eq 'Running') { return "running" }
    return "stopped"
}

#endregion

#region User Autostart (Fallback)

function Set-UserAutostart {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$CommandLine
    )
    
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    
    if (-not (Test-Path $runKey)) {
        New-Item -Path $runKey -Force | Out-Null
    }
    
    New-ItemProperty -Path $runKey -Name $Name -Value $CommandLine -PropertyType String -Force | Out-Null
    Write-Debug "User autostart set: $Name"
}

function Remove-UserAutostart {
    param([string]$Name)
    
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    
    if (Test-Path $runKey) {
        try {
            Remove-ItemProperty -Path $runKey -Name $Name -ErrorAction Stop
            Write-Debug "User autostart removed: $Name"
        } catch { }
    }
}

#endregion

#region Inventory

function Get-TaskInventory {
    param([string]$Name = $script:TaskName)
    
    $items = @()
    
    # Find all ManLab-related tasks
    try {
        $tasks = Get-ScheduledTask -ErrorAction Stop | Where-Object {
            $_.TaskName -like '*ManLab*' -or $_.TaskName -like '*Agent*'
        }
        
        foreach ($t in $tasks) {
            $items += "Task: $($t.TaskPath)$($t.TaskName)"
        }
    } catch { }
    
    return $items
}

#endregion

Export-ModuleMember -Function @(
    'Get-AgentScheduledTask', 'New-AgentSystemTask', 'New-AgentUserTask',
    'Remove-AgentTask', 'Start-AgentTask', 'Get-AgentTaskStatus',
    'Stop-AgentProcesses',
    'Set-UserAutostart', 'Remove-UserAutostart',
    'Get-TaskInventory'
) -Variable @('TaskName', 'TaskNameUser')
