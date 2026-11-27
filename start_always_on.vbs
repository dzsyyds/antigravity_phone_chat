Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = baseDir
nodeExe = "node"
If fso.FileExists("D:\new folder\node.exe") Then
    nodeExe = """D:\new folder\node.exe"""
End If
shell.Run nodeExe & " """ & baseDir & "\daemon_launcher.mjs""", 0, False
