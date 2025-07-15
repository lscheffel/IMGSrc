from PyQt5.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QTableWidget, QTableWidgetItem, QPushButton, QFileDialog, QMessageBox
from PyQt5.QtCore import Qt
import os
import sqlite3

class HistoryTab:
    def __init__(self, conn, cursor, redis_client, result_list):
        self.conn = conn
        self.cursor = cursor
        self.redis_client = redis_client
        self.result_list = result_list
        self.widget = QWidget()
        self.init_ui()

    def init_ui(self):
        history_layout = QVBoxLayout(self.widget)

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

    def clear_history(self):
        try:
            if QMessageBox.question(self.widget, 'Limpar Histórico', 'Deseja limpar todo o histórico de downloads?',
                                   QMessageBox.Yes | QMessageBox.No, QMessageBox.No) == QMessageBox.Yes:
                self.cursor.execute('DELETE FROM downloads')
                self.conn.commit()
                if self.redis_client:
                    self.redis_client.flushdb()
                self.result_list.addItem("Histórico limpo com sucesso.")
                self.result_list.scrollToBottom()
                self.update_history_view()
        except sqlite3.Error as e:
            self.result_list.addItem(f"Erro ao limpar histórico: {e}")
            self.result_list.scrollToBottom()

    def export_history(self):
        try:
            file_path, _ = QFileDialog.getSaveFileName(self.widget, "Salvar Histórico", "", "CSV Files (*.csv)")
            if file_path:
                self.cursor.execute('SELECT filename, user, url, download_date, path, status FROM downloads')
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write('filename,user,url,download_date,path,status\n')
                    for row in self.cursor.fetchall():
                        f.write(','.join(str(x).replace(',', '') for x in row) + '\n')
                self.result_list.addItem(f"Histórico exportado para: {file_path}")
                self.result_list.scrollToBottom()
        except (sqlite3.Error, OSError) as e:
            self.result_list.addItem(f"Erro ao exportar histórico: {e}")
            self.result_list.scrollToBottom()

    def update_history_view(self):
        try:
            self.history_table.setRowCount(0)
            self.cursor.execute('SELECT DISTINCT user, path FROM downloads WHERE status="active"')
            galleries = {f"{user} - {os.path.basename(os.path.dirname(path))}"
                         for user, path in self.cursor.fetchall()}

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
            self.result_list.scrollToBottom()