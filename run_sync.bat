@echo off
rem 切换到批处理所在目录（项目根，跟随项目移动）
cd /d "%~dp0"
rem Python 解释器路径：换机器时只改这一行
SET PYTHON=C:\Users\Hp\AppData\Local\Programs\Python\Python313\python.exe
"%PYTHON%" -X utf8 sync.py >> sync_log.txt 2>&1