Set ws = CreateObject("Wscript.Shell")
ws.Run """" & WScript.ScriptFullName & "\..\start-scheduler.cmd""", 0, False
