Set ws = CreateObject("Wscript.Shell")
ws.Run """" & WScript.ScriptFullName & "\..\start-api.cmd""", 0, False
