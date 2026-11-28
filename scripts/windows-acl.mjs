import { execFileSync } from 'node:child_process';
import { resolveWindowsSystem32 } from './windows-batch.mjs';

const CHECK_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$path = $env:DIF_ACL_PATH
$directory = $env:DIF_ACL_DIRECTORY -eq '1'
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $path
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
if ($owner -ne $current.Value) { throw "owner mismatch: $owner" }
$expectedSids = @($current.Value, 'S-1-5-18', 'S-1-5-32-544')
function Test-AclExact($aclToCheck, $expected, $isDirectory) {
  if (-not $aclToCheck.AreAccessRulesProtected) { return $false }
  $rules = @($aclToCheck.Access)
  if ($rules.Count -ne 3) { return $false }
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($expected -notcontains $sid) { return $false }
    if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { return $false }
    if ($rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { return $false }
    if ($isDirectory) {
      if (($rule.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]::ContainerInherit) -eq 0) { return $false }
      if (($rule.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) -eq 0) { return $false }
      if ($rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None) { return $false }
    } elseif ($rule.InheritanceFlags -ne [System.Security.AccessControl.InheritanceFlags]::None) {
      return $false
    }
  }
  return $true
}
$sids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
$state = if (Test-AclExact $acl $expectedSids $directory) { 'exact' } else { 'inexact' }
"$state|$($sids -join ',')"
`;

const INSPECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$acl = Get-Acl -LiteralPath $env:DIF_ACL_PATH
$sids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
$sids -join ','
`;

function runPowerShell(script, env) {
	const encoded = Buffer.from(script, 'utf16le').toString('base64');
	return execFileSync(
		resolveWindowsSystem32(String.raw`WindowsPowerShell\v1.0\powershell.exe`, env),
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

function inspectWindowsAcl(path, directory, env) {
	const output = runPowerShell(CHECK_SCRIPT, {
		...env,
		DIF_ACL_PATH: path,
		DIF_ACL_DIRECTORY: directory ? '1' : '0',
	});
	const [state, sids = ''] = output.split('|');
	return { exact: state === 'exact', sids: sids.split(',').filter(Boolean) };
}

function applyWindowsAcl(path, directory, env) {
	const sid = getCurrentUserSid(env);
	const suffix = directory ? '(OI)(CI)F' : 'F';
	const grants = [sid, 'S-1-5-18', 'S-1-5-32-544'].map((grant) => `*${grant}:${suffix}`);
	const icacls = resolveWindowsSystem32('icacls.exe', env);
	execFileSync(icacls, [path, '/reset'], { encoding: 'utf8', env, windowsHide: true });
	execFileSync(icacls, [path, '/inheritance:r'], { encoding: 'utf8', env, windowsHide: true });
	execFileSync(icacls, [path, '/grant:r', ...grants], {
		encoding: 'utf8',
		env,
		windowsHide: true,
	});
}

export function hardenWindowsPrivatePath(path, { directory = false, env = process.env } = {}) {
	if (process.platform !== 'win32') return path;
	const initialState = inspectWindowsAcl(path, directory, env);
	if (initialState.exact) return path;
	applyWindowsAcl(path, directory, env);
	const finalState = inspectWindowsAcl(path, directory, env);
	if (!finalState.exact) {
		throw new Error('Windows ACL does not match the exact owner/SYSTEM/Administrators allowlist.');
	}
	const expected = new Set([getCurrentUserSid(env), 'S-1-5-18', 'S-1-5-32-544']);
	const actual = new Set(finalState.sids);
	if (actual.size !== expected.size || [...expected].some((sid) => !actual.has(sid))) {
		throw new Error('Windows ACL does not match the owner/SYSTEM/Administrators allowlist.');
	}
	return path;
}
