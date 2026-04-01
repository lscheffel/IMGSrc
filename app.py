import sys
import requests
from bs4 import BeautifulSoup
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QLineEdit, QPushButton, QListWidget, QFileDialog, QSpinBox, QLabel, QCheckBox,
                             QTabWidget, QMessageBox, QProgressBar)
from PyQt5.QtCore import Qt, QThread, pyqtSignal
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import re
from datetime import datetime
import sqlite3
import redis
import hashlib
import logging
import time
import concurrent.futures
from history import HistoryTab
from preview import PreviewTab
import threading
import validators
import mimetypes
import uuid
import tempfile

# Configurar logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

class ScraperThread(QThread):
    result_signal = pyqtSignal(list, int, int)
    error_signal = pyqtSignal(str)
    title_signal = pyqtSignal(str, str)  # Inclui URL para identificação
    user_signal = pyqtSignal(str, str)   # Inclui URL para identificação
    progress_signal = pyqtSignal(str)

    def __init__(self, urls, min_size, max_scrape_threads, max_url_workers):
        super().__init__()
        self.urls = urls if isinstance(urls, list) else [urls]
        self.min_size = min_size * 1024
        self.max_scrape_threads = max(1, min(max_scrape_threads, 10))  # Máximo 10
        self.max_url_workers = max(1, min(max_url_workers, 16))        # Máximo 16
        self.rate_limit_delay = 0.1

    def run(self):
        all_image_urls = []
        total_images = 0
        discarded_images = 0

        for url in self.urls:
            try:
                if not validators.url(url) or not url.startswith('https://imgsrc.ru'):
                    self.error_signal.emit(f"URL inválida ou fora do domínio imgsrc.ru: {url}")
                    continue

                logging.debug(f"Acessando URL da galeria: {url}")
                session = requests.Session()
                session.headers.update({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                })
                response = session.get(url, timeout=5)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, 'html.parser')
                logging.debug(f"HTML da galeria parsed para {url}")

                tape_link = soup.find('a', href=re.compile(r'/[^/]+/tape-\d+-\d+-\d+\.html(?:\?pwd=)?'))
                if not tape_link:
                    self.error_signal.emit(f"Link do tape não encontrado para {url}.")
                    continue
                tape_url = tape_link['href']
                tape_url = f"https://imgsrc.ru{tape_url}" if tape_url.startswith('/') else tape_url
                self.progress_signal.emit(f"Link do tape: {tape_url}")

                logging.debug(f"Acessando URL do tape: {tape_url}")
                response = session.get(tape_url, timeout=5)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, 'html.parser')
                logging.debug("HTML do tape parsed")

                user_match = re.match(r'https://imgsrc\.ru/([^/]+)/', tape_url)
                user_name = user_match.group(1) if user_match else "unknown_user"
                self.user_signal.emit(user_name, url)

                title_tag = soup.find('title')
                page_title = title_tag.text.split(' @')[0] if title_tag else ""
                page_title = re.sub(r'[^\w\s-]', '', page_title).strip()
                page_title = re.sub(r'\s+', '_', page_title).rstrip('_') or f"album_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                self.title_signal.emit(page_title, url)
                self.progress_signal.emit(f"Título da subpasta para {url}: {page_title}")

                page_urls = [tape_url]
                for link in soup.find_all('a', href=re.compile(r'tape-.*\.html(?:\?pwd=)?$')):
                    page_url = link['href']
                    page_url = f"https://imgsrc.ru{page_url}" if page_url.startswith('/') else page_url
                    if page_url not in page_urls:
                        page_urls.append(page_url)

                def scrape_page(current_url, page_index):
                    page_images = []
                    page_total_images = 0
                    page_discarded_images = 0
                    retries = 3
                    session = requests.Session()
                    session.headers.update({
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    })
                    while retries > 0:
                        self.progress_signal.emit(f"Buscando página {page_index} ({current_url})...")
                        logging.debug(f"Processando página: {current_url} (tentativa {4 - retries})")
                        try:
                            response = session.get(current_url, timeout=5)
                            response.raise_for_status()
                            soup = BeautifulSoup(response.text, 'html.parser')

                            img_urls = []
                            for tag in soup.find_all(['source', 'img'], srcset=True) + soup.find_all('img', src=True):
                                img_url = tag.get('srcset') or tag.get('src')
                                if not img_url:
                                    continue
                                if '/images/1.gif' in img_url:
                                    logging.debug(f"URL descartado (irrelevante): {img_url}")
                                    continue
                                if not img_url.lower().endswith(('.webp', '.gif', '.jpg', '.png')):
                                    logging.debug(f"URL descartado (formato inválido): {img_url}")
                                    continue
                                page_total_images += 1
                                if img_url.lower().endswith(('.jpg', '.png')):
                                    page_discarded_images += 1
                                    logging.debug(f"URL descartado (miniatura .jpg/.png): {img_url}")
                                    continue
                                if img_url.startswith('//'):
                                    img_url = f"https:{img_url}"
                                elif not img_url.startswith('http'):
                                    img_url = f"https://imgsrc.ru{img_url}"
                                img_urls.append(img_url)

                            def check_image(img_url):
                                for attempt in range(3):  # Máximo 3 tentativas
                                    try:
                                        head_response = session.get(img_url, stream=True, timeout=5)
                                        if head_response.status_code == 404:
                                            logging.debug(f"404 em {img_url}, tentativa {attempt + 1}/3")
                                            time.sleep(3)
                                            continue
                                        if head_response.status_code != 200:
                                            logging.debug(f"URL com erro {head_response.status_code}: {img_url}")
                                            return img_url, None
                                        content_type = head_response.headers.get('content-type', '')
                                        if not content_type.startswith('image/'):
                                            logging.debug(f"URL descartado (não é imagem): {img_url}")
                                            return img_url, None
                                        size = int(head_response.headers.get('content-length', 0))
                                        head_response.close()
                                        if size >= self.min_size:
                                            logging.debug(f"Imagem válida encontrada: {img_url} ({size // 1024} KB)")
                                            return img_url, (img_url, size, user_name, page_title)
                                        else:
                                            logging.debug(f"Imagem descartada (tamanho pequeno): {img_url} ({size // 1024} KB)")
                                            return img_url, None
                                    except requests.RequestException as e:
                                        logging.warning(f"Erro ao verificar imagem {img_url}: {e}")
                                        if attempt < 2:
                                            time.sleep(3)
                                        return img_url, None
                                logging.debug(f"Imagem descartada após 3 tentativas 404: {img_url}")
                                return img_url, None

                            with ThreadPoolExecutor(max_workers=self.max_url_workers) as executor:
                                futures = [executor.submit(check_image, url) for url in img_urls]
                                for future in concurrent.futures.as_completed(futures):
                                    img_url, result = future.result()
                                    if result:
                                        page_images.append(result)
                                    else:
                                        page_discarded_images += 1

                            self.progress_signal.emit(f"Foram encontradas: {len(page_images)} imagens válidas (.webp/.gif), {page_discarded_images} descartadas (.jpg/.png ou inválidas), do total de {page_total_images} presentes na página")
                            time.sleep(self.rate_limit_delay)
                            return page_images, page_total_images, page_discarded_images
                        except requests.RequestException as e:
                            logging.error(f"Erro na página {current_url}: {e}")
                            self.progress_signal.emit(f"Erro na página {page_index}, tentando novamente ({retries} tentativas restantes)...")
                            retries -= 1
                            time.sleep(3)
                            if retries == 0:
                                self.progress_signal.emit(f"Erro na página {page_index}, continuando...")
                                return [], page_total_images, page_discarded_images
                    return [], page_total_images, page_discarded_images

                with ThreadPoolExecutor(max_workers=self.max_scrape_threads) as executor:
                    futures = [executor.submit(scrape_page, url, i) for i, url in enumerate(page_urls, 1)]
                    for future in concurrent.futures.as_completed(futures):
                        page_images, page_total, page_discarded = future.result()
                        all_image_urls.extend(page_images)
                        total_images += page_total
                        discarded_images += page_discarded

            except requests.RequestException as e:
                logging.error(f"Erro de rede para {url}: {e}")
                self.error_signal.emit(f"Erro ao acessar URL {url}: {e}")
            except ValueError as e:
                logging.error(f"Erro de validação para {url}: {e}")
                self.error_signal.emit(f"Erro de validação para {url}: {e}")
            except Exception as e:
                logging.error(f"Erro inesperado para {url}: {e}")
                self.error_signal.emit(f"Erro inesperado para {url}: {e}")

        logging.debug(f"Total de imagens válidas encontradas: {len(all_image_urls)}")
        self.result_signal.emit(all_image_urls, total_images, discarded_images)

class DownloadThread(QThread):
    progress_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(int, float, int, int)

    def __init__(self, image_urls, dest_folder, downloaded_urls_set, redis_client, conn, cursor, max_workers, overwrite, db_lock):
        super().__init__()
        self.image_urls = image_urls  # Lista de (url, size, user, title)
        self.dest_folder = os.path.normpath(dest_folder)
        self.downloaded_urls_set = downloaded_urls_set
        self.redis_client = redis_client
        self.conn = conn
        self.cursor = cursor
        self.max_workers = max(1, min(max_workers, 48))  # Máximo 48
        self.overwrite = overwrite
        self.db_lock = db_lock
        self.rate_limit_delay = 0.5

    def check_write_permission(self, folder):
        try:
            os.makedirs(folder, exist_ok=True)
            temp_file = tempfile.NamedTemporaryFile(delete=False, dir=folder, suffix='.tmp')
            temp_file.write(b"test")
            temp_file.close()
            os.unlink(temp_file.name)
            logging.debug(f"Permissão de escrita confirmada para: {folder}")
            return True
        except (OSError, PermissionError) as e:
            logging.error(f"Sem permissão de escrita em {folder}: {e}")
            return False

    def run(self):
        try:
            logging.debug(f"Iniciando DownloadThread com {len(self.image_urls)} URLs")
            urls_to_download = []
            skip_messages = []
            total_bytes = 0
            total_downloads = 0
            total_errors = 0

            if not self.check_write_permission(self.dest_folder):
                raise OSError(f"Sem permissão de escrita na pasta: {self.dest_folder}")

            for url, size, user_name, page_title in self.image_urls:
                try:
                    url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
                    if not self.overwrite:
                        with self.db_lock:
                            self.cursor.execute('SELECT download_date FROM downloads WHERE url_hash=?', (url_hash,))
                            date = self.cursor.fetchone()
                        redis_exists = self.redis_client and self.redis_client.sismember('imgscraper:downloaded_urls', url_hash)
                        if date or redis_exists:
                            logging.debug(f"Imagem pulada (já existe): {url} (data: {date[0] if date else 'Redis'})")
                            skip_messages.append(f"Imagem pulada: {url} (já baixada em {date[0] if date else 'desconhecido'})")
                            continue
                    urls_to_download.append((url, size, user_name, page_title))
                except sqlite3.Error as e:
                    logging.error(f"Erro ao verificar duplicata para {url}: {e}")
                    self.progress_signal.emit(f"Erro ao verificar duplicata para {url}: {e}")
                    total_errors += 1
                    continue

            logging.debug(f"URLs para download: {len(urls_to_download)}")

            def download_single_image(url, user_name, page_title):
                try:
                    dest_folder = self.dest_folder
                    if user_name:
                        dest_folder = os.path.join(dest_folder, re.sub(r'[^\w\s-]', '', user_name))
                        os.makedirs(dest_folder, exist_ok=True)
                    if page_title:
                        dest_folder = os.path.join(dest_folder, re.sub(r'[^\w\s-]', '', page_title))
                        os.makedirs(dest_folder, exist_ok=True)
                    if not self.check_write_permission(dest_folder):
                        raise OSError(f"Sem permissão de escrita para {dest_folder}")

                    filename_base = url.split('/')[-1]
                    filename_base = re.sub(r'[^\w\s.-]', '', filename_base)
                    if not filename_base.lower().endswith(('.webp', '.gif')):
                        filename_base += '.webp'
                    filename = os.path.join(dest_folder, filename_base)
                    if os.path.exists(filename) and not self.overwrite:
                        base, ext = os.path.splitext(filename_base)
                        filename = os.path.join(dest_folder, f"{base}_{uuid.uuid4().hex[:8]}{ext}")

                    for attempt in range(3):  # Máximo 3 tentativas
                        try:
                            with urllib.request.urlopen(url, timeout=5) as response:
                                if response.status == 404:
                                    logging.debug(f"404 em {url}, tentativa {attempt + 1}/3")
                                    time.sleep(3)
                                    continue
                                if response.status != 200:
                                    raise ValueError(f"Erro {response.status} ao baixar {url}")
                                size = int(response.getheader('Content-Length', 0))
                                content_type = response.getheader('Content-Type', '')
                                if not content_type.startswith('image/'):
                                    raise ValueError(f"URL não é imagem: {url} ({content_type})")
                                data = response.read()
                            with open(filename, 'wb') as f:
                                f.write(data)
                            if os.path.getsize(filename) != size:
                                raise ValueError(f"Download incompleto ou corrompido: {filename}")
                            logging.debug(f"Download concluído: {filename} ({size // 1024} KB)")
                            time.sleep(self.rate_limit_delay)
                            return url, filename, size, f"Baixado: {filename}"
                        except (urllib.error.HTTPError, urllib.error.URLError) as e:
                            if getattr(e, 'code', None) == 404 and attempt < 2:
                                continue
                            logging.error(f"Erro ao baixar {url}: {e}")
                            return url, None, 0, f"Erro ao baixar {url}: {e}"
                        except (ValueError, OSError, TimeoutError) as e:
                            logging.error(f"Erro ao baixar {url}: {e}")
                            return url, None, 0, f"Erro ao baixar {url}: {e}"
                    logging.debug(f"Imagem descartada após 3 tentativas 404: {url}")
                    return url, None, 0, f"Erro ao baixar {url}: falhou após 3 tentativas 404"
                except Exception as e:
                    logging.error(f"Erro inesperado ao baixar {url}: {e}")
                    return url, None, 0, f"Erro inesperado ao baixar {url}: {e}"

            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = [executor.submit(download_single_image, url, user_name, page_title) for url, _, user_name, page_title in urls_to_download]
                for future in concurrent.futures.as_completed(futures):
                    url, filename, size, message = future.result()
                    self.progress_signal.emit(message)
                    if filename:
                        total_downloads += 1
                        total_bytes += size
                        try:
                            url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
                            with self.db_lock:
                                self.cursor.execute('''
                                    INSERT OR REPLACE INTO downloads (filename, user, url, url_hash, download_date, path, status)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)
                                ''', (os.path.basename(filename), user_name, url, url_hash,
                                      datetime.now().strftime('%Y-%m-%d %H:%M:%S'), filename, 'active'))
                                self.conn.commit()
                            if self.redis_client:
                                self.redis_client.sadd('imgscraper:downloaded_urls', url_hash)
                            self.downloaded_urls_set.add(url_hash)
                        except sqlite3.Error as e:
                            self.progress_signal.emit(f"Erro ao registrar download {url}: {e}")
                            logging.error(f"Erro ao registrar download {url}: {e}")
                            total_errors += 1
                    else:
                        total_errors += 1

            for message in skip_messages:
                self.progress_signal.emit(message)

            logging.debug(f"DownloadThread concluído: {total_downloads} downloads, {total_bytes / (1024 * 1024):.2f} MB, {len(skip_messages)} pulados, {total_errors} erros")
            self.finished_signal.emit(total_downloads, total_bytes / (1024 * 1024), len(skip_messages), total_errors)
        except (OSError, sqlite3.Error) as e:
            logging.error(f"Erro geral no DownloadThread: {e}")
            self.progress_signal.emit(f"Erro geral no download: {e}")
            self.finished_signal.emit(0, 0.0, len(skip_messages), total_errors + 1)

class ImageScraper(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Image Scraper")
        self.setGeometry(100, 100, 800, 500)
        self.image_urls = []
        self.page_titles = {}  # URL -> título
        self.user_names = {}   # URL -> usuário
        self.downloaded_urls_set = set()
        self.scraper_thread = None
        self.download_thread = None
        self.db_lock = threading.Lock()
        self.init_db(clear_cache=True)
        self.init_redis(clear_cache=True)
        self.load_cache()
        self.init_ui()

    def init_db(self, clear_cache=False):
        try:
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
            self.cursor.execute('CREATE INDEX IF NOT EXISTS idx_status ON downloads(status)')
            if clear_cache:
                logging.debug("Limpando cache do SQLite na inicialização")
                self.cursor.execute('DELETE FROM downloads')
                self.conn.commit()
        except sqlite3.Error as e:
            logging.error(f"Erro ao inicializar banco de dados: {e}")
            raise

    def init_redis(self, clear_cache=False):
        try:
            self.redis_client = redis.Redis(host='localhost', port=6379, db=0)
            self.redis_client.ping()
            if clear_cache:
                logging.debug("Limpando cache do Redis na inicialização")
                self.redis_client.delete('imgscraper:downloaded_urls')
        except redis.ConnectionError as e:
            self.redis_client = None
            logging.warning(f"Redis não disponível, usando apenas SQLite: {e}")

    def load_cache(self):
        try:
            self.downloaded_urls_set = set()
            with self.db_lock:
                self.cursor.execute('SELECT url_hash FROM downloads WHERE status="active" LIMIT 10000')
                self.downloaded_urls_set = {row[0] for row in self.cursor.fetchall()}
            logging.debug(f"Cache carregado: {len(self.downloaded_urls_set)} URLs")
        except sqlite3.Error as e:
            logging.error(f"Erro ao carregar cache: {e}")

    def sync_folders(self):
        try:
            with self.db_lock:
                self.cursor.execute('SELECT url, path FROM downloads WHERE status="active" LIMIT 1000')
                for url, path in self.cursor.fetchall():
                    if not os.path.exists(path):
                        url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
                        self.cursor.execute('UPDATE downloads SET status="deleted" WHERE url_hash=?', (url_hash,))
                        if self.redis_client:
                            self.redis_client.srem('imgscraper:downloaded_urls', url_hash)
                self.conn.commit()
            self.load_cache()
        except (sqlite3.Error, OSError) as e:
            self.result_list.addItem(f"Erro ao sincronizar pastas: {e}")
            self.result_list.scrollToBottom()

    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)

        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)

        main_tab = QWidget()
        main_layout = QVBoxLayout(main_tab)

        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Digite URLs das galerias (ex.: https://imgsrc.ru/.../84647553.html, ...)")
        main_layout.addWidget(self.url_input)

        size_layout = QHBoxLayout()
        size_layout.addWidget(QLabel("Tamanho mínimo (KB):"))
        self.size_input = QSpinBox()
        self.size_input.setValue(10)
        self.size_input.setRange(1, 10000)
        size_layout.addWidget(self.size_input)
        main_layout.addLayout(size_layout)

        conn_layout = QHBoxLayout()
        conn_layout.addWidget(QLabel("Downloads Paralelos:"))
        self.conn_input = QSpinBox()
        self.conn_input.setValue(16)
        self.conn_input.setRange(1, 48)
        conn_layout.addWidget(self.conn_input)
        main_layout.addLayout(conn_layout)

        scrape_threads_layout = QHBoxLayout()
        scrape_threads_layout.addWidget(QLabel("Páginas Tape:"))
        self.scrape_threads_input = QSpinBox()
        self.scrape_threads_input.setValue(2)
        self.scrape_threads_input.setRange(1, 10)
        scrape_threads_layout.addWidget(self.scrape_threads_input)
        main_layout.addLayout(scrape_threads_layout)

        url_workers_layout = QHBoxLayout()
        url_workers_layout.addWidget(QLabel("Scraping Paralelo:"))
        self.url_workers_input = QSpinBox()
        self.url_workers_input.setValue(6)
        self.url_workers_input.setRange(1, 16)
        url_workers_layout.addWidget(self.url_workers_input)
        main_layout.addLayout(url_workers_layout)

        self.user_folder_check = QCheckBox("Criar pasta de usuário")
        self.user_folder_check.setChecked(True)
        main_layout.addWidget(self.user_folder_check)

        self.subfolder_check = QCheckBox("Criar subpasta com título do álbum")
        self.subfolder_check.setChecked(True)
        main_layout.addWidget(self.subfolder_check)

        self.overwrite_check = QCheckBox("Sobrescrever imagens existentes")
        self.overwrite_check.setChecked(False)
        main_layout.addWidget(self.overwrite_check)

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

        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        main_layout.addWidget(self.progress_bar)

        self.tabs.addTab(main_tab, "Busca e Download")

        self.history_tab = HistoryTab(self.conn, self.cursor, self.redis_client, self.result_list, self.db_lock)
        self.tabs.addTab(self.history_tab.widget, "Histórico de Downloads")

        self.preview_tab = PreviewTab(self.result_list)
        self.tabs.addTab(self.preview_tab.widget, "Preview")

        self.history_tab.update_history_view()

    def set_controls_enabled(self, enabled):
        self.url_input.setEnabled(enabled)
        self.size_input.setEnabled(enabled)
        self.conn_input.setEnabled(enabled)
        self.scrape_threads_input.setEnabled(enabled)
        self.url_workers_input.setEnabled(enabled)
        self.user_folder_check.setEnabled(enabled)
        self.subfolder_check.setEnabled(enabled)
        self.overwrite_check.setEnabled(enabled)
        self.search_btn.setEnabled(enabled)
        self.one_click_btn.setEnabled(enabled)
        self.download_btn.setEnabled(enabled)
        self.folder_btn.setEnabled(enabled)
        self.tabs.setEnabled(enabled)
        self.progress_bar.setVisible(not enabled)

    def check_write_permission(self, folder):
        try:
            os.makedirs(folder, exist_ok=True)
            temp_file = tempfile.NamedTemporaryFile(delete=False, dir=folder, suffix='.tmp')
            temp_file.write(b"test")
            temp_file.close()
            os.unlink(temp_file.name)
            logging.debug(f"Permissão de escrita confirmada para: {folder}")
            return True
        except (OSError, PermissionError) as e:
            logging.error(f"Sem permissão de escrita em {folder}: {e}")
            return False

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Selecione a pasta de destino")
        if folder:
            folder = os.path.normpath(folder)
            if not os.path.exists(folder):
                try:
                    os.makedirs(folder, exist_ok=True)
                    logging.debug(f"Pasta criada em select_folder: {folder}")
                except OSError as e:
                    self.result_list.addItem(f"Erro ao criar pasta: {folder}: {e}")
                    self.result_list.scrollToBottom()
                    return
            if not self.check_write_permission(folder):
                self.result_list.addItem(f"Sem permissão de escrita na pasta: {folder}")
                self.result_list.scrollToBottom()
                return
            self.folder_input.setText(folder)

    def search_images(self):
        if self.scraper_thread and self.scraper_thread.isRunning():
            self.result_list.addItem("Aguarde a busca atual concluir!")
            self.result_list.scrollToBottom()
            return

        self.result_list.clear()
        self.preview_tab.clear()
        self.image_urls = []
        self.page_titles = {}
        self.user_names = {}
        urls = [url.strip() for url in self.url_input.text().split(',') if url.strip()]
        if not urls:
            self.result_list.addItem("Digite pelo menos uma URL válida!")
            self.result_list.scrollToBottom()
            return

        self.set_controls_enabled(False)
        self.progress_bar.setRange(0, 0)
        self.result_list.addItem(f"Iniciando busca de imagens (.webp, .gif) para {len(urls)} galerias...")
        self.result_list.scrollToBottom()
        self.sync_folders()

        try:
            self.scraper_thread = ScraperThread(urls, self.size_input.value(), self.scrape_threads_input.value(), self.url_workers_input.value())
            self.scraper_thread.result_signal.connect(self.display_results)
            self.scraper_thread.error_signal.connect(self.display_error)
            self.scraper_thread.title_signal.connect(self.set_page_title)
            self.scraper_thread.user_signal.connect(self.set_user_name)
            self.scraper_thread.progress_signal.connect(self.add_item_and_scroll)
            self.scraper_thread.finished.connect(self.search_finished)
            self.scraper_thread.start()
        except (ValueError, sqlite3.Error) as e:
            logging.error(f"Erro ao iniciar ScraperThread: {e}")
            self.result_list.addItem(f"Erro ao iniciar busca: {e}")
            self.result_list.scrollToBottom()
            self.set_controls_enabled(True)

    def set_page_title(self, title, url):
        self.page_titles[url] = title

    def set_user_name(self, user, url):
        self.user_names[url] = user

    def add_item_and_scroll(self, message):
        self.result_list.addItem(message)
        self.result_list.scrollToBottom()

    def display_results(self, image_urls, total_images, discarded_images):
        try:
            self.image_urls = image_urls  # (url, size, user, title)
            for url, size, user_name, page_title in image_urls:
                self.result_list.addItem(f"{url} ({size // 1024} KB) [Usuário: {user_name}, Título: {page_title}]")
            self.preview_tab.display_images([(url, size) for url, size, _, _ in image_urls])
            self.result_list.addItem(
                f"Busca concluída com sucesso!\n"
                f"Estatísticas gerais: "
                f"Imagens válidas (.webp/.gif): {len(image_urls)}, "
                f"Imagens descartadas (.jpg/.png ou inválidas): {discarded_images}, "
                f"Total processado: {total_images}"
            )
            self.result_list.scrollToBottom()
        except (ValueError, AttributeError) as e:
            logging.error(f"Erro em display_results: {e}")
            self.result_list.addItem(f"Erro ao exibir resultados: {e}")
            self.result_list.scrollToBottom()

    def display_error(self, error_msg):
        self.result_list.addItem(error_msg)
        self.result_list.scrollToBottom()

    def search_finished(self):
        self.set_controls_enabled(True)
        self.progress_bar.setRange(0, 1)
        if not self.image_urls:
            self.result_list.addItem("Nenhuma imagem .webp ou .gif encontrada!")
            self.result_list.scrollToBottom()
        self.scraper_thread = None

    def download_images(self, force_user_folder=False, force_subfolder=False, force_overwrite=False):
        try:
            folder = self.folder_input.text()
            if not folder:
                self.result_list.addItem("Selecione uma pasta de destino!")
                self.result_list.scrollToBottom()
                return
            if not self.image_urls:
                self.result_list.addItem("Nenhuma imagem para baixar!")
                self.result_list.scrollToBottom()
                return

            folder = os.path.normpath(folder)
            if not os.path.exists(folder):
                try:
                    os.makedirs(folder, exist_ok=True)
                    logging.debug(f"Pasta base criada: {folder}")
                except OSError as e:
                    self.result_list.addItem(f"Erro ao criar pasta base: {folder}: {e}")
                    self.result_list.scrollToBottom()
                    return

            if not self.check_write_permission(folder):
                self.result_list.addItem(f"Sem permissão de escrita na pasta: {folder}")
                self.result_list.scrollToBottom()
                return

            if self.download_thread and self.download_thread.isRunning():
                self.result_list.addItem("Aguarde o download atual concluir!")
                self.result_list.scrollToBottom()
                return

            logging.debug(f"Iniciando download com {len(self.image_urls)} URLs")
            self.set_controls_enabled(False)
            self.progress_bar.setRange(0, 0)
            self.download_thread = DownloadThread(
                self.image_urls, folder, self.downloaded_urls_set,
                self.redis_client, self.conn, self.cursor, self.conn_input.value(),
                force_overwrite or self.overwrite_check.isChecked(), self.db_lock
            )
            self.download_thread.progress_signal.connect(self.add_item_and_scroll)
            self.download_thread.finished_signal.connect(self.download_finished)
            self.download_thread.start()
        except (OSError, ValueError) as e:
            logging.error(f"Erro em download_images: {e}")
            self.result_list.addItem(f"Erro ao iniciar download: {e}")
            self.result_list.scrollToBottom()
            self.set_controls_enabled(True)

    def download_finished(self, total_downloads, total_mb, skipped, errors):
        try:
            self.result_list.addItem(
                f"Download concluído com sucesso!\n"
                f"Estatísticas: Downloads concluídos: {total_downloads}, "
                f"Total baixado: {total_mb:.2f} MB, "
                f"Itens descartados (já baixados): {skipped}, "
                f"Erros: {errors}"
            )
            self.result_list.scrollToBottom()
            self.history_tab.update_history_view()
            self.sync_folders()
            self.set_controls_enabled(True)
            self.download_thread = None
        except (sqlite3.Error, OSError) as e:
            logging.error(f"Erro em download_finished: {e}")
            self.result_list.addItem(f"Erro ao finalizar download: {e}")
            self.result_list.scrollToBottom()
            self.set_controls_enabled(True)

    def one_click(self):
        if self.scraper_thread and self.scraper_thread.isRunning():
            self.result_list.addItem("Aguarde a busca atual concluir!")
            self.result_list.scrollToBottom()
            return

        self.result_list.clear()
        self.preview_tab.clear()
        self.image_urls = []
        self.page_titles = {}
        self.user_names = {}
        urls = [url.strip() for url in self.url_input.text().split(',') if url.strip()]
        if not urls:
            self.result_list.addItem("Digite pelo menos uma URL válida!")
            self.result_list.scrollToBottom()
            return
        if not self.folder_input.text():
            self.result_list.addItem("Selecione uma pasta de destino!")
            self.result_list.scrollToBottom()
            return

        self.set_controls_enabled(False)
        self.progress_bar.setRange(0, 0)
        self.result_list.addItem(f"Iniciando One Click: busca e download (.webp, .gif) para {len(urls)} galerias...")
        self.result_list.scrollToBottom()
        self.sync_folders()

        try:
            logging.debug("Iniciando ScraperThread para One Click")
            self.scraper_thread = ScraperThread(urls, self.size_input.value(), self.scrape_threads_input.value(), self.url_workers_input.value())
            self.scraper_thread.result_signal.connect(lambda image_urls, total, discarded: self.one_click_download(image_urls, total, discarded))
            self.scraper_thread.error_signal.connect(self.display_error)
            self.scraper_thread.title_signal.connect(self.set_page_title)
            self.scraper_thread.user_signal.connect(self.set_user_name)
            self.scraper_thread.progress_signal.connect(self.add_item_and_scroll)
            self.scraper_thread.finished.connect(self.search_finished)
            self.scraper_thread.start()
        except (ValueError, sqlite3.Error) as e:
            logging.error(f"Erro ao iniciar ScraperThread em one_click: {e}")
            self.result_list.addItem(f"Erro ao iniciar One Click: {e}")
            self.result_list.scrollToBottom()
            self.set_controls_enabled(True)

    def one_click_download(self, image_urls, total_images, discarded_images):
        try:
            logging.debug("Iniciando one_click_download")
            self.display_results(image_urls, total_images, discarded_images)
            if self.image_urls:
                logging.debug(f"Chamando download_images para One Click com {len(self.image_urls)} URLs")
                self.download_images(
                    force_user_folder=self.user_folder_check.isChecked(),
                    force_subfolder=self.subfolder_check.isChecked(),
                    force_overwrite=self.overwrite_check.isChecked()
                )
            else:
                self.result_list.addItem(
                    f"One Click concluído: nenhuma imagem para baixar!\n"
                    f"Estatísticas gerais: "
                    f"Imagens válidas (.webp/.gif): {len(self.image_urls)}, "
                    f"Imagens descartadas (.jpg/.png ou inválidas): {discarded_images}, "
                    f"Total processado: {total_images}"
                )
                self.result_list.scrollToBottom()
                self.set_controls_enabled(True)
                logging.debug("one_click_download concluído sem downloads")
        except (ValueError, AttributeError) as e:
            logging.error(f"Erro em one_click_download: {e}")
            self.result_list.addItem(f"Erro ao finalizar One Click: {e}")
            self.result_list.scrollToBottom()
            self.set_controls_enabled(True)

if __name__ == '__main__':
    try:
        app = QApplication(sys.argv)
        window = ImageScraper()
        window.show()
        sys.exit(app.exec_())
    except Exception as e:
        logging.error(f"Erro fatal na inicialização do aplicativo: {e}")