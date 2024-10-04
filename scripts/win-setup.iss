#include "./win-setup-config.h";

[Setup]
AppId=8af243ba-487b-436e-b766-aaf4805852f1
AppName=datatruck
AppVerName=datatruck
AppVersion={#VERSION}
AppPublisher=Juanra GM
AppPublisherURL=https://github.com/swordev/datatruck
DefaultDirName={commonpf}\swordev\datatruck
DefaultGroupName=datatruck
PrivilegesRequired=admin
OutputDir=./../bin/
OutputBaseFilename=datatruck-{#VERSION}-win-setup

[Files]
Source: "/../bin/datatruck-{#VERSION}-win.exe"; DestDir: "{app}\bin"; DestName: "datatruck.exe"; Flags: ignoreversion

[Run]
Filename: "{cmd}"; Parameters: "/C mklink ""{app}\bin\dtt.exe"" ""{app}\bin\datatruck.exe"""

[UninstallDelete]
Type: files; Name: "{app}\bin\dtt.exe"
