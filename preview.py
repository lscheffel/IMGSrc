from PyQt5.QtWidgets import QWidget, QVBoxLayout, QPushButton, QTableWidget, QTableWidgetItem, QFileDialog
from PyQt5.QtCore import Qt, QUrl
from PyQt5.QtGui import QPixmap, QDesktopServices
from PyQt5.QtNetwork import QNetworkAccessManager, QNetworkRequest
import json
import logging

class PreviewTab:
    def __init__(self, result_list):
        self.result_list = result_list
        self.widget = QWidget()
        self.network_manager = QNetworkAccessManager()
        self.image_cache = {}  # Cache para miniaturas
        self.image_urls = []
        self.max_cache_size = 100  # Limite de imagens no cache
        self.init_ui()

    def init_ui(self):
        preview_layout = QVBoxLayout(self.widget)

        self.preview_table = QTableWidget()
        self.preview_table.setColumnCount(3)
        self.preview_table.setHorizontalHeaderLabels(['Thumbnail', 'URL', 'Tamanho (KB)'])
        self.preview_table.setSortingEnabled(True)
        self.preview_table.cellClicked.connect(self.open_url)
        preview_layout.addWidget(self.preview_table)

        export_json_btn = QPushButton("Exportar JSON")
        export_json_btn.clicked.connect(self.export_json)
        preview_layout.addWidget(export_json_btn)

    def open_url(self, row, column):
        try:
            if column == 1:  # Coluna da URL
                url = self.preview_table.item(row, column).text()
                QDesktopServices.openUrl(QUrl(url))
        except AttributeError as e:
            self.result_list.addItem(f"Erro ao abrir URL: {e}")
            self.result_list.scrollToBottom()

    def load_thumbnail(self, url, row):
        try:
            if url in self.image_cache:
                pixmap = self.image_cache[url]
                item = QTableWidgetItem()
                item.setData(Qt.DecorationRole, pixmap.scaled(200, 200, Qt.KeepAspectRatio, Qt.SmoothTransformation))
                self.preview_table.setItem(row, 0, item)
                return

            request = QNetworkRequest(QUrl(url))
            reply = self.network_manager.get(request)
            reply.finished.connect(lambda: self.handle_thumbnail(reply, row, url))
        except ValueError as e:
            self.result_list.addItem(f"Erro ao carregar miniatura {url}: {e}")
            self.result_list.scrollToBottom()

    def handle_thumbnail(self, reply, row, url):
        try:
            if reply.error() == reply.NoError:
                data = reply.readAll()
                pixmap = QPixmap()
                if not pixmap.loadFromData(data):
                    raise ValueError("Imagem corrompida ou inválida")
                if len(self.image_cache) >= self.max_cache_size:
                    self.image_cache.pop(next(iter(self.image_cache)))  # Remover item mais antigo
                self.image_cache[url] = pixmap
                item = QTableWidgetItem()
                item.setData(Qt.DecorationRole, pixmap.scaled(200, 200, Qt.KeepAspectRatio, Qt.SmoothTransformation))
                self.preview_table.setItem(row, 0, item)
            else:
                item = QTableWidgetItem("Erro")
                self.preview_table.setItem(row, 0, item)
                self.result_list.addItem(f"Erro ao carregar miniatura {url}: {reply.errorString()}")
            reply.deleteLater()
        except ValueError as e:
            item = QTableWidgetItem("Imagem inválida")
            self.preview_table.setItem(row, 0, item)
            self.result_list.addItem(f"Erro ao processar miniatura {url}: {e}")
            self.result_list.scrollToBottom()

    def display_images(self, image_urls):
        try:
            self.image_urls = [url for url, _ in image_urls]
            self.preview_table.setRowCount(len(image_urls))
            for row, (url, size) in enumerate(image_urls):
                self.preview_table.setRowHeight(row, 200)
                url_item = QTableWidgetItem(url)
                url_item.setFlags(url_item.flags() & ~Qt.ItemIsEditable)
                self.preview_table.setItem(row, 1, url_item)
                size_item = QTableWidgetItem(f"{size // 1024} KB")
                size_item.setFlags(size_item.flags() & ~Qt.ItemIsEditable)
                self.preview_table.setItem(row, 2, size_item)
                item = QTableWidgetItem("Carregando...")
                self.preview_table.setItem(row, 0, item)
                self.load_thumbnail(url, row)
            self.preview_table.resizeColumnsToContents()
            self.preview_table.setColumnWidth(0, 100)
        except (ValueError, AttributeError) as e:
            self.result_list.addItem(f"Erro ao exibir imagens na aba Preview: {e}")
            self.result_list.scrollToBottom()

    def export_json(self):
        try:
            file_path, _ = QFileDialog.getSaveFileName(self.widget, "Exportar Lista de Imagens", "", "JSON Files (*.json)")
            if file_path:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(self.image_urls, f, indent=2)
                self.result_list.addItem(f"Lista de imagens exportada para: {file_path}")
                self.result_list.scrollToBottom()
        except OSError as e:
            self.result_list.addItem(f"Erro ao exportar JSON: {e}")
            self.result_list.scrollToBottom()

    def clear(self):
        try:
            self.preview_table.setRowCount(0)
            self.image_urls = []
            self.image_cache.clear()
        except Exception as e:
            self.result_list.addItem(f"Erro ao limpar aba Preview: {e}")
            self.result_list.scrollToBottom()