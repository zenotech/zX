import os
import pty
import asyncio
import struct
import fcntl
import termios
import logging
from fastapi import WebSocket

logger = logging.getLogger("zx_terminal")

class TerminalSession:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.master_fd = None
        self.pid = None
        self.read_task = None

    def start(self):
        # Fork the process using pty
        self.pid, self.master_fd = pty.fork()
        if self.pid == 0:
            # Child process
            # Let's find the shell or fallback
            shell = os.environ.get("SHELL", "/bin/sh")
            os.environ["TERM"] = "xterm-256color"
            try:
                os.execv(shell, [shell])
            except Exception:
                try:
                    os.execv("/bin/bash", ["/bin/bash"])
                except Exception:
                    os.execv("/bin/sh", ["/bin/sh"])
        else:
            # Parent process
            # Set master fd to non-blocking
            fl = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
            fcntl.fcntl(self.master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
            
            loop = asyncio.get_event_loop()
            self.read_task = loop.create_task(self.read_from_pty())

    async def read_from_pty(self):
        try:
            while True:
                await asyncio.sleep(0.01)
                try:
                    data = os.read(self.master_fd, 4096)
                    if not data:
                        break
                    await self.ws.send_text(data.decode("utf-8", errors="replace"))
                except BlockingIOError:
                    continue
                except OSError:
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"PTY read error: {e}")
        finally:
            try:
                await self.ws.close()
            except Exception:
                pass

    def write_to_pty(self, data: str):
        if self.master_fd:
            try:
                os.write(self.master_fd, data.encode("utf-8"))
            except Exception as e:
                logger.error(f"PTY write error: {e}")

    def resize(self, rows: int, cols: int):
        if self.master_fd:
            try:
                s = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, s)
            except Exception as e:
                logger.error(f"PTY resize error: {e}")

    def close(self):
        if self.read_task:
            self.read_task.cancel()
        if self.master_fd:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
        if self.pid:
            try:
                os.kill(self.pid, 9)
            except OSError:
                pass
