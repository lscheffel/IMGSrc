import sys
import requests
from bs4 import BeautifulSoup
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QLineEdit, QPushButton, QListWidget, QFileDialog, QSpinBox, QLabel, QCheckBox,
                             QTabWidget, QTableWidget, QTableWidgetItem, QMessageBox)
from PyQt5.QtCore import Qt, QThread, pyqtSignal, QObject
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import re
from datetime import datetime
import sqlite3
import redis
import hashlib
import time
import random
import asyncio
import nest_asyncio
from pyppeteer import launch

# Apply nest_asyncio as a fallback
nest_asyncio.apply()

# Lista de user-agents reais e populares
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
]

class DownloadThread(QThread):
    progress_signal = pyqtSignal(str)
    result_signal = pyqtSignal(str, str, str)  # url, filename, message

    def __init__(self, urls, dest_folder, user_name, page_title, overwrite, redis_client, downloaded_urls_set, cursor, conn):
        super().__init__()
        self.urls = urls
        self.dest_folder = dest_folder
        self.user_name = user_name
        self.page_title = page_title
        self.overwrite = overwrite
        self.redis_client = redis_client
        self.downloaded_urls_set = downloaded_urls_set
        self.cursor = cursor
        self.conn = conn

    def run(self):
        import urllib.request
        import hashlib
        from datetime import datetime
        import os
        import time
        import random
        max_retries = 3
        retry_delay = 5
        for url in self.urls:
            url_hash = hashlib.md5(url.encode()).hexdigest()
            filename = os.path.join(self.dest_folder, url.split('/')[-1])
            if not self.overwrite and (
                url_hash in self.downloaded_urls_set or
                (self.redis_client and self.redis_client.sismember('downloaded_urls', url_hash))
            ):
                self.cursor.execute('SELECT download_date FROM downloads WHERE url_hash=?', (url_hash,))
                date = self.cursor.fetchone()
                msg = f"Imagem pulada: {url} (já baixada em {date[0] if date else 'desconhecido'})"
                self.progress_signal.emit(msg)
                continue
            for attempt in range(max_retries):
                try:
                    urllib.request.urlretrieve(url, filename)
                    msg = f"Baixado: {filename}"
                    self.result_signal.emit(url, filename, msg)
                    break
                except Exception as e:
                    if attempt + 1 == max_retries:
                        msg = f"Erro ao baixar {url} após {max_retries} tentativas: {e}"
                        self.result_signal.emit(url, None, msg)
                    time.sleep(retry_delay + random.uniform(2, 5))

class ScraperSignals(QObject):
    progress_signal = pyqtSignal(str)
    error_signal = pyqtSignal(str)
    title_signal = pyqtSignal(str, str)  # title, url
    user_signal = pyqtSignal(str, str)   # user, url
    result_signal = pyqtSignal(list, str, str)  # image_urls, page_url, gallery_url

class ImageScraper(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Image Scraper")
        self.setGeometry(100, 100, 800, 500)
        self.image_urls = []
        self.page_title = "album"
        self.user_name = "unknown_user"
        self.downloaded_urls_set = set()
        self.image_urls_dict = {}  # Cache por URL do tape
        self.init_db()
        self.init_redis()
        self.load_cache()
        self.init_ui()
        self.scraper_signals = ScraperSignals()
        self.scraper_signals.progress_signal.connect(self.result_list.addItem)
        self.scraper_signals.error_signal.connect(self.display_error)
        self.scraper_signals.title_signal.connect(self.set_page_title)
        self.scraper_signals.user_signal.connect(self.set_user_name)
        self.scraper_signals.result_signal.connect(self.display_results)

    def init_db(self):
        self.conn = sqlite3.connect('downloads.db', check_same_thread=False)
        self.cursor = self.conn.cursor()
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY,
                filename TEXT,
                user TEXT,
                url TEXT UNIQUE,
                url_hash TEXT,
                download_date TEXT,
                path TEXT,
                status TEXT
            )
        ''')
        self.cursor.execute('CREATE INDEX IF NOT EXISTS idx_url_hash ON downloads(url_hash)')
        self.conn.commit()

    def init_redis(self):
        try:
            self.redis_client = redis.Redis(host='localhost', port=6379, db=0)
            self.redis_client.ping()
        except redis.ConnectionError:
            self.redis_client = None
            print("Redis não disponível, usando apenas SQLite.")

    def load_cache(self):
        self.downloaded_urls_set = set()
        try:
            self.cursor.execute('SELECT url_hash FROM downloads WHERE status="active"')
            for row in self.cursor.fetchall():
                self.downloaded_urls_set.add(row[0])
        except sqlite3.Error as e:
            print(f"Erro ao carregar cache do SQLite: {e}")

    def sync_folders(self):
        try:
            self.cursor.execute('SELECT url, path FROM downloads WHERE status="active"')
            for url, path in self.cursor.fetchall():
                if not os.path.exists(path):
                    url_hash = hashlib.md5(url.encode()).hexdigest()
                    self.cursor.execute('UPDATE downloads SET status="deleted" WHERE url_hash=?', (url_hash,))
                    if self.redis_client:
                        self.redis_client.srem('downloaded_urls', url_hash)
            self.conn.commit()
            self.load_cache()
        except sqlite3.Error as e:
            self.result_list.addItem(f"Erro ao sincronizar pastas: {e}")

    def clear_history(self):
        reply = QMessageBox.question(self, 'Limpar Histórico', 'Deseja limpar todo o histórico de downloads?',
                                    QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if reply == QMessageBox.Yes:
            try:
                self.cursor.execute('DELETE FROM downloads')
                self.conn.commit()
                if self.redis_client:
                    self.redis_client.flushdb()
                self.downloaded_urls_set.clear()
                self.result_list.addItem("Histórico limpo com sucesso.")
                self.update_history_view()
            except sqlite3.Error as e:
                self.result_list.addItem(f"Erro ao limpar histórico: {e}")

    def export_history(self):
        file_path, _ = QFileDialog.getSaveFileName(self, "Salvar Histórico", "", "CSV Files (*.csv)")
        if file_path:
            try:
                self.cursor.execute('SELECT filename, user, url, download_date, path, status FROM downloads')
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write('filename,user,url,download_date,path,status\n')
                    for row in self.cursor.fetchall():
                        f.write(','.join(str(x).replace(',', '') for x in row) + '\n')
                self.result_list.addItem(f"Histórico exportado para: {file_path}")
            except (sqlite3.Error, OSError) as e:
                self.result_list.addItem(f"Erro ao exportar histórico: {e}")

    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)

        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)

        main_tab = QWidget()
        main_layout = QVBoxLayout(main_tab)

        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Digite URLs de galerias ou tapes (ex.: https://imgsrc.ru/.../79781003.html ou tape-...html, separadas por vírgula)")
        main_layout.addWidget(self.url_input)

        size_layout = QHBoxLayout()
        size_layout.addWidget(QLabel("Tamanho mínimo (KB):"))
        self.size_input = QSpinBox()
        self.size_input.setValue(10)
        self.size_input.setRange(1, 10000)
        size_layout.addWidget(self.size_input)
        main_layout.addLayout(size_layout)

        conn_layout = QHBoxLayout()
        conn_layout.addWidget(QLabel("Conexões simultâneas (downloads):"))
        self.conn_input = QSpinBox()
        self.conn_input.setValue(5)
        self.conn_input.setRange(1, 20)
        conn_layout.addWidget(self.conn_input)
        main_layout.addLayout(conn_layout)

        self.user_folder_check = QCheckBox("Criar pasta de usuário")
        self.user_folder_check.setChecked(False)
        main_layout.addWidget(self.user_folder_check)

        self.subfolder_check = QCheckBox("Criar subpasta com título do álbum")
        self.subfolder_check.setChecked(True)
        main_layout.addWidget(self.subfolder_check)

        self.overwrite_check = QCheckBox("Sobrescrever imagens existentes")
        self.overwrite_check.setChecked(False)
        main_layout.addWidget(self.overwrite_check)

        self.tape_direct_check = QCheckBox("Scrape Tape Directly")
        self.tape_direct_check.setChecked(False)
        main_layout.addWidget(self.tape_direct_check)

        self.search_btn = QPushButton("Search")
        self.search_btn.clicked.connect(self.search_images)
        main_layout.addWidget(self.search_btn)

        self.one_click_btn = QPushButton("One Click!")
        self.one_click_btn.clicked.connect(self.one_click)
        main_layout.addWidget(self.one_click_btn)

        self.result_list = QListWidget()
        main_layout.addWidget(self.result_list)

        folder_layout = QHBoxLayout()
        self.folder_input = QLineEdit()
        self.folder_input.setPlaceholderText("Selecione a pasta de destino")
        folder_layout.addWidget(self.folder_input)
        self.folder_btn = QPushButton("Browse")
        self.folder_btn.clicked.connect(self.select_folder)
        folder_layout.addWidget(self.folder_btn)
        main_layout.addLayout(folder_layout)

        self.download_btn = QPushButton("Download")
        self.download_btn.clicked.connect(self.download_images)
        main_layout.addWidget(self.download_btn)

        self.tabs.addTab(main_tab, "Busca e Download")

        history_tab = QWidget()
        history_layout = QVBoxLayout(history_tab)

        self.history_table = QTableWidget()
        self.history_table.setColumnCount(6)
        self.history_table.setHorizontalHeaderLabels(['Filename', 'User', 'URL', 'Download Date', 'Path', 'Status'])
        self.history_table.setSortingEnabled(True)
        history_layout.addWidget(self.history_table)

        history_btn_layout = QHBoxLayout()
        self.clear_btn = QPushButton("Limpar Histórico")
        self.clear_btn.clicked.connect(self.clear_history)
        history_btn_layout.addWidget(self.clear_btn)

        self.export_btn = QPushButton("Exportar Histórico")
        self.export_btn.clicked.connect(self.export_history)
        history_btn_layout.addWidget(self.export_btn)
        history_layout.addLayout(history_btn_layout)

        self.tabs.addTab(history_tab, "Histórico de Downloads")
        self.update_history_view()

    async def fetch_page(self, url):
        executable_path = "C:\\Program Files\\Chromium\\chrome.exe"  # Windows
        from pyppeteer import launch
        import random
        browser = await launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath=executable_path
        )
        page = await browser.newPage()
        await page.setUserAgent(random.choice(USER_AGENTS))
        try:
            await page.goto(url, {'timeout': 30000, 'waitUntil': 'networkidle2'})
            content = await page.content()
            await browser.close()
            return content
        except Exception as e:
            await browser.close()
            raise Exception(f"Erro ao acessar {url}: {e}")

    async def scrape_gallery(self, url, min_size, scrape_tape_directly):
        import re
        from bs4 import BeautifulSoup
        import requests
        import time
        import random
        from datetime import datetime
        max_retries = 3
        retry_delay = 5
        images_per_page = 24
        tape_url = None
        signals = self.scraper_signals
        # Determinar URL do tape
        if scrape_tape_directly:
            tape_url = url
            signals.progress_signal.emit(f"Usando URL do tape diretamente: {tape_url}")
        else:
            for attempt in range(max_retries):
                try:
                    content = await self.fetch_page(url)
                    soup = BeautifulSoup(content, 'html.parser')
                    tape_link = soup.find('a', href=re.compile(r'/[^/]+/tape-\\d+-\\d+-0\\.html\\?pwd='))
                    if not tape_link:
                        signals.error_signal.emit(f"Link do tape não encontrado na página da galeria: {url}")
                        return
                    tape_url = tape_link['href']
                    if tape_url.startswith('/'):
                        tape_url = f"https://imgsrc.ru{tape_url}"
                    elif not tape_url.startswith('http'):
                        tape_url = f"https://imgsrc.ru/{tape_url}"
                    signals.progress_signal.emit(f"Link do tape encontrado: {tape_url}")
                    break
                except Exception as e:
                    signals.progress_signal.emit(f"Erro ao acessar galeria {url} (tentativa {attempt + 1}/{max_retries}): {e}")
                    if attempt + 1 == max_retries:
                        signals.error_signal.emit(f"Falha após {max_retries} tentativas: {url}")
                        return
                    time.sleep(retry_delay + random.uniform(2, 5))
        # Acessar página do tape para extrair usuário e título
        if not tape_url:
            signals.error_signal.emit("URL do tape não foi definida.")
            return
        for attempt in range(max_retries):
            try:
                content = await self.fetch_page(tape_url)
                soup = BeautifulSoup(content, 'html.parser')
                break
            except Exception as e:
                signals.progress_signal.emit(f"Erro ao acessar tape {tape_url} (tentativa {attempt + 1}/{max_retries}): {e}")
                if attempt + 1 == max_retries:
                    signals.error_signal.emit(f"Falha após {max_retries} tentativas: {tape_url}")
                    return
                time.sleep(retry_delay + random.uniform(2, 5))
        # Extrair nome do usuário
        user_match = re.match(r'https://imgsrc\\.ru/([^/]+)/', tape_url)
        user_name = user_match.group(1) if user_match else "unknown_user"
        signals.user_signal.emit(user_name, url)
        # Extrair título
        title_tag = soup.find('title')
        page_title = title_tag.text.split(' @')[0] if title_tag else ""
        import re as _re
        page_title = _re.sub(r'[^\\w\\s-]', '', page_title).strip()
        page_title = _re.sub(r'\\s+', '_', page_title).rstrip('_')
        page_title = _re.sub(r'_+', '_', page_title)
        if not page_title:
            page_title = f"album_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        signals.title_signal.emit(page_title, url)
        signals.progress_signal.emit(f"Título da subpasta: {page_title}")
        # Extrair URLs das páginas do tape
        page_urls = [tape_url]
        page_links = soup.find_all('a', href=re.compile(r'/[^/]+/tape-\\d+-\\d+-\\d+\\.html\\?pwd='))
        for link in page_links:
            page_url = link['href']
            if page_url.startswith('/'):
                page_url = f"https://imgsrc.ru{page_url}"
            if page_url not in page_urls:
                page_urls.append(page_url)
        signals.progress_signal.emit(f"Páginas do tape encontradas: {len(page_urls)}")
        # Processar cada página sequencialmente
        session = requests.Session()
        min_size_bytes = min_size * 1024
        for i, current_url in enumerate(page_urls, 1):
            is_last_page = i == len(page_urls)
            signals.progress_signal.emit(f"Buscando página {i} ({current_url})...")
            image_urls = []
            for attempt in range(max_retries):
                try:
                    content = await self.fetch_page(current_url)
                    soup = BeautifulSoup(content, 'html.parser')
                    source_tags = soup.find_all('source', srcset=re.compile(r'\\.webp$'))
                    page_image_count = 0
                    temp_image_urls = []
                    for tag in source_tags:
                        img_url = tag.get('srcset')
                        if not img_url:
                            continue
                        if img_url.startswith('//'):
                            img_url = f"https:{img_url}"
                        elif not img_url.startswith('http'):
                            img_url = f"https://imgsrc.ru{img_url}"
                        for img_attempt in range(max_retries):
                            try:
                                session.headers.update({'User-Agent': random.choice(USER_AGENTS)})
                                img_response = session.head(img_url, allow_redirects=True, timeout=3)
                                size = int(img_response.headers.get('content-length', 0))
                                if size >= min_size_bytes:
                                    temp_image_urls.append((img_url, size))
                                    page_image_count += 1
                                break
                            except requests.RequestException as e:
                                signals.progress_signal.emit(f"Erro ao verificar imagem {img_url} (tentativa {img_attempt + 1}/{max_retries}): {e}")
                                if img_attempt + 1 == max_retries:
                                    signals.progress_signal.emit(f"Falha ao verificar imagem após {max_retries} tentativas: {img_url}")
                                time.sleep(retry_delay + random.uniform(2, 5))
                    if page_image_count < images_per_page and not is_last_page and len(page_urls) > 1:
                        signals.progress_signal.emit(f"Aviso: Página {i} tem {page_image_count} imagens, esperado {images_per_page}. Tentando novamente...")
                        if attempt + 1 == max_retries:
                            signals.progress_signal.emit(f"Falha na página {i} após {max_retries} tentativas: {page_image_count} imagens encontradas")
                            image_urls = temp_image_urls
                            break
                        time.sleep(retry_delay + random.uniform(2, 5))
                        continue
                    else:
                        image_urls = temp_image_urls
                        signals.progress_signal.emit(f"Imagens .webp encontradas na página {i}: {page_image_count}")
                        break
                except Exception as e:
                    signals.progress_signal.emit(f"Erro na página {i} ({current_url}) (tentativa {attempt + 1}/{max_retries}): {e}")
                    if attempt + 1 == max_retries:
                        signals.progress_signal.emit(f"Falha na página {i} após {max_retries} tentativas")
                    time.sleep(retry_delay + random.uniform(2, 5))
                    continue
            signals.result_signal.emit(image_urls, current_url, url)
            time.sleep(random.uniform(2, 10))

    def search_images(self):
        self.result_list.clear()
        self.image_urls = []
        self.image_urls_dict = {}
        urls_input = self.url_input.text().strip()
        if not urls_input:
            self.result_list.addItem("Digite pelo menos uma URL válida!")
            return
        self.search_btn.setEnabled(False)
        self.one_click_btn.setEnabled(False)
        self.result_list.addItem("Iniciando busca de imagens (.webp, .gif)...")
        self.sync_folders()
        urls = [url.strip() for url in urls_input.split(',') if url.strip()]
        if not urls:
            self.result_list.addItem("Nenhuma URL válida fornecida!")
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            return
        async def run_all():
            for url in urls:
                self.result_list.addItem(f"Processando: {url}")
                await self.scrape_gallery(url, self.size_input.value(), self.tape_direct_check.isChecked())
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            if not self.image_urls:
                self.result_list.addItem("Nenhuma imagem .webp ou .gif encontrada!")
        asyncio.ensure_future(run_all())

    def set_page_title(self, title, url):
        if not hasattr(self, 'titles'):
            self.titles = {}
        self.titles[url] = title
        self.page_title = title

    def set_user_name(self, user, url):
        if not hasattr(self, 'users'):
            self.users = {}
        self.users[url] = user
        self.user_name = user

    def display_results(self, image_urls, page_url, gallery_url):
        if not self.image_urls_dict.get(gallery_url):
            self.image_urls_dict[gallery_url] = []
        self.image_urls_dict[gallery_url].extend([img_url for img_url, _ in image_urls])
        self.image_urls.extend([img_url for img_url, _ in image_urls])
        for img_url, size in image_urls:
            self.result_list.addItem(f"{page_url}: {img_url} ({size // 1024} KB)")

    def display_error(self, error_msg):
        self.result_list.addItem(error_msg)

    def download_images(self, force_user_folder=False, force_subfolder=False, force_overwrite=False):
        folder = self.folder_input.text()
        if not folder:
            self.result_list.addItem("Selecione uma pasta de destino!")
            return
        if not self.image_urls:
            self.result_list.addItem("Nenhuma imagem para baixar!")
            return
        for gallery_url in self.image_urls_dict:
            user_name = self.users.get(gallery_url, "unknown_user")
            page_title = self.titles.get(gallery_url, f"album_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
            dest_folder = folder
            if force_user_folder or self.user_folder_check.isChecked():
                try:
                    dest_folder = os.path.join(folder, user_name)
                    os.makedirs(dest_folder, exist_ok=True)
                    self.result_list.addItem(f"Pasta de usuário criada: {dest_folder}")
                except Exception as e:
                    self.result_list.addItem(f"Erro ao criar pasta de usuário '{user_name}': {e}. Usando pasta raiz.")
                    dest_folder = folder
            if force_subfolder or self.subfolder_check.isChecked():
                try:
                    dest_folder = os.path.join(dest_folder, page_title)
                    os.makedirs(dest_folder, exist_ok=True)
                    self.result_list.addItem(f"Subpasta criada: {dest_folder}")
                except Exception as e:
                    self.result_list.addItem(f"Erro ao criar subpasta '{page_title}': {e}. Usando pasta anterior.")
            self.result_list.addItem(f"Estrutura criada para {gallery_url}: {dest_folder}")
            urls_to_download = self.image_urls_dict.get(gallery_url, [])
            thread = DownloadThread(urls_to_download, dest_folder, user_name, page_title, force_overwrite or self.overwrite_check.isChecked(), self.redis_client, self.downloaded_urls_set, self.cursor, self.conn)
            thread.progress_signal.connect(self.result_list.addItem)
            def on_result(url, filename, message):
                self.result_list.addItem(message)
                if filename:
                    url_hash = hashlib.md5(url.encode()).hexdigest()
                    self.cursor.execute('''
                        INSERT OR REPLACE INTO downloads (filename, user, url, url_hash, download_date, path, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    ''', (os.path.basename(filename), user_name, url, url_hash, 
                          datetime.now().strftime('%Y-%m-%d %H:%M:%S'), filename, 'active'))
                    self.conn.commit()
                    if self.redis_client:
                        self.redis_client.sadd('downloaded_urls', url_hash)
                    self.downloaded_urls_set.add(url_hash)
            thread.result_signal.connect(on_result)
            thread.finished.connect(self.update_history_view)
            thread.finished.connect(self.sync_folders)
            thread.start()

    def one_click(self):
        self.result_list.clear()
        self.image_urls = []
        self.image_urls_dict = {}
        urls_input = self.url_input.text().strip()
        if not urls_input:
            self.result_list.addItem("Digite pelo menos uma URL válida!")
            return
        if not self.folder_input.text():
            self.result_list.addItem("Selecione uma pasta de destino!")
            return
        self.search_btn.setEnabled(False)
        self.one_click_btn.setEnabled(False)
        self.result_list.addItem("Iniciando One Click: busca e download (.webp, .gif)...")
        self.sync_folders()
        urls = [url.strip() for url in urls_input.split(',') if url.strip()]
        if not urls:
            self.result_list.addItem("Nenhuma URL válida fornecida!")
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            return
        async def run_all():
            for url in urls:
                self.result_list.addItem(f"Processando: {url}")
                await self.scrape_gallery(url, self.size_input.value(), self.tape_direct_check.isChecked())
                if self.image_urls_dict.get(url):
                    self.download_images(force_user_folder=True, force_subfolder=True, force_overwrite=True)
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
        asyncio.ensure_future(run_all())

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Selecione a pasta de destino")
        if folder:
            self.folder_input.setText(folder)

    def update_history_view(self):
        try:
            self.history_table.setRowCount(0)
            self.cursor.execute('SELECT DISTINCT user, path FROM downloads WHERE status="active"')
            galleries = set()
            for user, path in self.cursor.fetchall():
                album = os.path.basename(os.path.dirname(path)) if self.subfolder_check.isChecked() else os.path.basename(path)
                galleries.add(f"{user} - {album}")

            self.cursor.execute('SELECT COUNT(*) FROM downloads')
            total_rows = len(galleries) + self.cursor.fetchone()[0]
            self.history_table.setRowCount(total_rows)
            row = 0
            for gallery in sorted(galleries):
                self.history_table.setItem(row, 0, QTableWidgetItem(gallery))
                row += 1

            self.cursor.execute('SELECT filename, user, url, download_date, path, status FROM downloads')
            for record in self.cursor.fetchall():
                for col, value in enumerate(record):
                    self.history_table.setItem(row, col, QTableWidgetItem(str(value)))
                row += 1
            self.history_table.resizeColumnsToContents()
        except sqlite3.Error as e:
            self.result_list.addItem(f"Erro ao atualizar histórico: {e}")

    def download_images(self, force_user_folder=False, force_subfolder=False, force_overwrite=False):
        folder = self.folder_input.text()
        if not folder:
            self.result_list.addItem("Selecione uma pasta de destino!")
            return
        if not self.image_urls:
            self.result_list.addItem("Nenhuma imagem para baixar!")
            return
        for gallery_url in self.image_urls_dict:
            user_name = self.users.get(gallery_url, "unknown_user")
            page_title = self.titles.get(gallery_url, f"album_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
            dest_folder = folder
            if force_user_folder or self.user_folder_check.isChecked():
                try:
                    dest_folder = os.path.join(folder, user_name)
                    os.makedirs(dest_folder, exist_ok=True)
                    self.result_list.addItem(f"Pasta de usuário criada: {dest_folder}")
                except Exception as e:
                    self.result_list.addItem(f"Erro ao criar pasta de usuário '{user_name}': {e}. Usando pasta raiz.")
                    dest_folder = folder
            if force_subfolder or self.subfolder_check.isChecked():
                try:
                    dest_folder = os.path.join(dest_folder, page_title)
                    os.makedirs(dest_folder, exist_ok=True)
                    self.result_list.addItem(f"Subpasta criada: {dest_folder}")
                except Exception as e:
                    self.result_list.addItem(f"Erro ao criar subpasta '{page_title}': {e}. Usando pasta anterior.")
            self.result_list.addItem(f"Estrutura criada para {gallery_url}: {dest_folder}")
            urls_to_download = self.image_urls_dict.get(gallery_url, [])
            thread = DownloadThread(urls_to_download, dest_folder, user_name, page_title, force_overwrite or self.overwrite_check.isChecked(), self.redis_client, self.downloaded_urls_set, self.cursor, self.conn)
            thread.progress_signal.connect(self.result_list.addItem)
            def on_result(url, filename, message):
                self.result_list.addItem(message)
                if filename:
                    url_hash = hashlib.md5(url.encode()).hexdigest()
                    self.cursor.execute('''
                        INSERT OR REPLACE INTO downloads (filename, user, url, url_hash, download_date, path, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    ''', (os.path.basename(filename), user_name, url, url_hash, 
                          datetime.now().strftime('%Y-%m-%d %H:%M:%S'), filename, 'active'))
                    self.conn.commit()
                    if self.redis_client:
                        self.redis_client.sadd('downloaded_urls', url_hash)
                    self.downloaded_urls_set.add(url_hash)
            thread.result_signal.connect(on_result)
            thread.finished.connect(self.update_history_view)
            thread.finished.connect(self.sync_folders)
            thread.start()

    def one_click(self):
        self.result_list.clear()
        self.image_urls = []
        self.image_urls_dict = {}
        urls_input = self.url_input.text().strip()
        if not urls_input:
            self.result_list.addItem("Digite pelo menos uma URL válida!")
            return
        if not self.folder_input.text():
            self.result_list.addItem("Selecione uma pasta de destino!")
            return
        self.search_btn.setEnabled(False)
        self.one_click_btn.setEnabled(False)
        self.result_list.addItem("Iniciando One Click: busca e download (.webp, .gif)...")
        self.sync_folders()
        urls = [url.strip() for url in urls_input.split(',') if url.strip()]
        if not urls:
            self.result_list.addItem("Nenhuma URL válida fornecida!")
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            return
        async def run_all():
            for url in urls:
                self.result_list.addItem(f"Processando: {url}")
                await self.scrape_gallery(url, self.size_input.value(), self.tape_direct_check.isChecked())
                if self.image_urls_dict.get(url):
                    self.download_images(force_user_folder=True, force_subfolder=True, force_overwrite=True)
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
        asyncio.ensure_future(run_all())

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = ImageScraper()
    window.show()
    sys.exit(app.exec_())