import { execFileSync } from 'node:child_process';
import { resolveWindowsSystem32 } from './windows-batch.mjs';

const HARDEN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$path = $env:DIF_ACL_PATH
$directory = $env:DIF_ACL_DIRECTORY -eq '1'
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $path
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if ($owner -ne $current.Value) { throw "owner mismatch: $owner" }
$expectedSids = @($current.Value, 'S-1-5-18', 'S-1-5-32-544')
$existingSids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
$alreadyExact = $acl.AreAccessRulesProtected -and $existingSids.Count -eq 3 -and @($existingSids | Where-Object { $expectedSids -notcontains $_ }).Count -eq 0
if ($alreadyExact) { $existingSids -join ','; exit 0 }
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }
$inheritance = [System.Security.AccessControl.InheritanceFlags]::None
if ($directory) {
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
}
$allowed = @(
  $current,
  (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')),
  (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544'))
)
foreach ($sid in $allowed) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $sid,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $path -AclObject $acl
$check = Get-Acl -LiteralPath $path
$checkSids = @($check.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
if (-not $check.AreAccessRulesProtected) { throw 'ACL inheritance still enabled' }
if ($checkSids.Count -ne 3) { throw "unexpected ACE count $($checkSids.Count)" }
foreach ($sid in $checkSids) { if ($allowed.Value -notcontains $sid) { throw "unexpected SID $sid" } }
$checkSids -join ','
`;

const INSPECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$acl = Get-Acl -LiteralPath $env:DIF_ACL_PATH
$sids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
$sids -join ','
`;

function runPowerShell(script, env) {
	const encoded = Buffer.from(script, 'utf16le').toString('base64');
	return execFileSync(
		resolveWindowsSystem32('WindowsPowerShell\\v1.0\\powershell.exe', env),
		['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
		{ encoding: 'utf8', env, windowsHide: true },
	).trim();
}

export function getCurrentUserSid(env = process.env) {
	const output = execFileSync(
		resolveWindowsSystem32('whoami.exe', env),
		['/user', '/fo', 'csv', '/nh'],
		{ encoding: 'utf8', env, windowsHide: true },
	);
	const match = output.match(/S-1-5-[\d-]+/);
	if (!match) throw new Error('Could not determine the current Windows user SID.');
	return match[0];
}

export function getWindowsAclSids(path, env = process.env) {
	const output = runPowerShell(INSPECT_SCRIPT, { ...env, DIF_ACL_PATH: path });
	return output.split(',').filter(Boolean);
}

export function hardenWindowsPrivatePath(path, { directory = false, env = process.env } = {}) {
	if (process.platform !== 'win32') return path;
	const sids = runPowerShell(HARDEN_SCRIPT, {
		...env,
		DIF_ACL_PATH: path,
		DIF_ACL_DIRECTORY: directory ? '1' : '0',
	});
	const expected = new Set([getCurrentUserSid(env), 'S-1-5-18', 'S-1-5-32-544']);
	const actual = new Set(sids.split(',').filter(Boolean));
	if (actual.size !== expected.size || [...expected].some((sid) => !actual.has(sid))) {
		throw new Error('Windows ACL does not match the owner/SYSTEM/Administrators allowlist.');
	}
	return path;
}
