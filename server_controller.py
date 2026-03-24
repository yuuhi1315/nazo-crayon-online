import tkinter as tk
import subprocess
import sys
import time

class ServerManager:
    def __init__(self, master):
        self.master = master
        master.title("なぞクレ サーバーコントローラー")
        master.geometry("380x150")
        # ウィンドウを常に最前面に表示して操作しやすくする
        master.attributes('-topmost', True)
        
        self.process = None
        
        self.status_label = tk.Label(master, text="Status: 停止中", fg="red", font=("Helvetica", 12, "bold"))
        self.status_label.pack(pady=15)
        
        self.btn_frame = tk.Frame(master)
        self.btn_frame.pack(pady=5)
        
        self.start_btn = tk.Button(
            self.btn_frame, text="▶ 起動", command=self.start_server, 
            width=12, bg="#10b981", fg="white", font=("", 10, "bold")
        )
        self.start_btn.grid(row=0, column=0, padx=10)
        
        self.restart_btn = tk.Button(
            self.btn_frame, text="🔄 再起動 (設定反映)", command=self.restart_server, 
            width=18, bg="#3b82f6", fg="white", font=("", 10, "bold")
        )
        self.restart_btn.grid(row=0, column=1, padx=10)
        
        # 初期化時に前回ターミナルで起動したものをどうするかは管理外ですが、
        # アプリ起動時に自身でサブプロセスとして起動します
        self.start_server()
        
    def start_server(self):
        if self.process is None or self.process.poll() is not None:
            # uvicorn をサブプロセスとしてバックグラウンドで起動
            cmd = [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "3000"]
            
            # Windows 環境においてコンソールウィンドウを出さないためのフラグ設定
            creationflags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            self.process = subprocess.Popen(cmd, creationflags=creationflags)
            
            self.status_label.config(text="Status: 稼働中 (Port: 3000)", fg="#10b981")
            
    def stop_server(self):
        if self.process and self.process.poll() is None:
            self.process.kill()
            self.process.wait() # 完全に終了するまで待機
            self.process = None
            self.status_label.config(text="Status: 停止中", fg="red")
            
    def restart_server(self):
        self.stop_server()
        time.sleep(0.5) # ポートの完全開放までのバッファ
        self.start_server()

if __name__ == "__main__":
    root = tk.Tk()
    app = ServerManager(root)
    
    # ウィンドウの×ボタンを押した際の処理
    def on_closing():
        app.stop_server()
        root.destroy()
        
    root.protocol("WM_DELETE_WINDOW", on_closing)
    root.mainloop()
