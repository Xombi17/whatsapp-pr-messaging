import threading
import tkinter as tk
from tkinter import ttk, messagebox

import whatsapp_bulk as wb


class WhatsAppGUI:
        def __init__(self, root: tk.Tk):
            self.root = root
            self.root.title("WhatsApp Bulk Sender")
            self.root.geometry("600x640")

            # State vars
            self.status_var = tk.StringVar(value="Idle")

            container = ttk.Frame(root, padding=12)
            container.pack(fill=tk.BOTH, expand=True)

            # Config frame
            cfg = ttk.Frame(container)
            cfg.pack(fill=tk.X)
            self.batch_size_var = tk.StringVar(value=str(wb.BATCH_SIZE))
            self.batch_delay_var = tk.StringVar(value=str(wb.BATCH_DELAY))
            self.contact_limit_var = tk.StringVar(value=str(wb.CONTACT_LIMIT))
            self.no_delay_var = tk.BooleanVar(value=wb.NO_DELAY)
            self.fast_mode_var = tk.BooleanVar(value=wb.FAST_MODE)

            def add_row(r, label, var, width=10):
                ttk.Label(cfg, text=label).grid(row=r, column=0, sticky='w')
                ttk.Entry(cfg, textvariable=var, width=width).grid(row=r, column=1, sticky='w')

            add_row(0, "Batch Size", self.batch_size_var)
            add_row(1, "Batch Delay", self.batch_delay_var)
            add_row(2, "Contact Limit", self.contact_limit_var)
            ttk.Checkbutton(cfg, text="No Delay", variable=self.no_delay_var).grid(row=0, column=2, sticky='w', padx=(12,0))
            ttk.Checkbutton(cfg, text="Fast Mode", variable=self.fast_mode_var).grid(row=1, column=2, sticky='w', padx=(12,0))

            # Manual numbers frame
            manual = ttk.LabelFrame(container, text="Manual Numbers & Message")
            manual.pack(fill=tk.BOTH, expand=False, pady=(8,4))
            inner = ttk.Frame(manual)
            inner.pack(fill=tk.BOTH, expand=True)
            self.numbers_text = tk.Text(inner, height=8, width=26)
            self.numbers_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0,8), pady=4)
            right = ttk.Frame(inner)
            right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
            ttk.Label(right, text="Message:").pack(anchor='w')
            self.message_text = tk.Text(right, height=8)
            self.message_text.pack(fill=tk.BOTH, expand=True, pady=(0,4))
            ttk.Label(right, text="Leave blank to use sheet messages").pack(anchor='w')

            # Buttons
            btns = ttk.Frame(container)
            btns.pack(fill=tk.X, pady=(6,4))
            ttk.Button(btns, text="Start", command=self.start).pack(side=tk.LEFT, padx=4)
            ttk.Button(btns, text="Check Only", command=self.check_only).pack(side=tk.LEFT, padx=4)
            ttk.Button(btns, text="Pause", command=self.pause).pack(side=tk.LEFT, padx=4)
            ttk.Button(btns, text="Resume", command=self.resume).pack(side=tk.LEFT, padx=4)
            ttk.Button(btns, text="Stop", command=self.stop).pack(side=tk.LEFT, padx=4)
            ttk.Button(btns, text="Quit", command=self.quit).pack(side=tk.RIGHT, padx=4)

            ttk.Label(container, text="Status:").pack(anchor='w')
            ttk.Label(container, textvariable=self.status_var, foreground='blue').pack(anchor='w')

            self.log_box = tk.Text(container, height=14, state='disabled', wrap='word')
            self.log_box.pack(fill=tk.BOTH, expand=True, pady=(6,0))

            self.worker_thread = None
            self._patch_logger()

        def _patch_logger(self):
            orig_info = wb.logging.info

            def hooked(msg, *a, **k):
                try:
                    txt = msg if not a else msg % a
                    self._append_log(txt)
                except Exception:
                    pass
                orig_info(msg, *a, **k)

            wb.logging.info = hooked

        def _append_log(self, text: str):
            self.log_box.configure(state='normal')
            self.log_box.insert(tk.END, text + "\n")
            self.log_box.see(tk.END)
            self.log_box.configure(state='disabled')

        def start(self):
            if self.worker_thread and self.worker_thread.is_alive():
                messagebox.showinfo("Running", "Campaign already running")
                return
            try:
                wb.BATCH_SIZE = int(self.batch_size_var.get())
                wb.BATCH_DELAY = int(self.batch_delay_var.get())
                wb.CONTACT_LIMIT = int(self.contact_limit_var.get())
            except ValueError:
                messagebox.showerror("Error", "Invalid numeric input")
                return
            wb.NO_DELAY = self.no_delay_var.get()
            wb.FAST_MODE = self.fast_mode_var.get()
            if wb.NO_DELAY and not wb.FAST_MODE:
                wb.FAST_MODE = True
            numbers = [n.strip() for n in self.numbers_text.get('1.0', tk.END).strip().splitlines() if n.strip()]
            message = self.message_text.get('1.0', tk.END).strip()
            if numbers:
                wb.set_manual_data(numbers, message)
            else:
                wb.MANUAL_DATA = None
            wb.PAUSE_EVENT.set()
            wb.STOP_EVENT.clear()
            self.status_var.set("Running")
            self.worker_thread = threading.Thread(target=self._run, daemon=True)
            self.worker_thread.start()
            self._append_log("Campaign started")

        def _run(self):
            try:
                wb.run_campaign()
                self.status_var.set("Finished")
            except Exception as e:
                self.status_var.set(f"Error: {e}")

        def pause(self):
            wb.pause_sending()
            self.status_var.set("Paused")

        def resume(self):
            wb.resume_sending()
            self.status_var.set("Running")

        def stop(self):
            wb.stop_sending()
            self.status_var.set("Stopping...")

        def quit(self):
            try:
                wb.stop_sending()
            except Exception:
                pass
            self.root.after(300, self.root.destroy)

        def check_only(self):
            if self.worker_thread and self.worker_thread.is_alive():
                messagebox.showinfo("Running", "Another task is running")
                return
            numbers = [n.strip() for n in self.numbers_text.get('1.0', tk.END).strip().splitlines() if n.strip()]
            if not numbers:
                messagebox.showerror("No Numbers", "Enter numbers to check")
                return
            self.status_var.set("Checking")
            self.worker_thread = threading.Thread(target=self._run_check, daemon=True)
            self.worker_thread.start()
            self._append_log("Started check-only run")

        def _run_check(self):
            try:
                numbers = [n.strip() for n in self.numbers_text.get('1.0', tk.END).strip().splitlines() if n.strip()]
                wb.open_chats_check_only(numbers)
                self.status_var.set("Check Complete")
            except Exception as e:
                self.status_var.set(f"Error: {e}")


def main():
    root = tk.Tk()
    WhatsAppGUI(root)
    root.mainloop()


if __name__ == '__main__':
    main()
