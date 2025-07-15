from PyQt5.QtWidgets import QWidget, QVBoxLayout, QPushButton

class NewTab:
    def __init__(self, result_list):
        self.result_list = result_list
        self.widget = QWidget()
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self.widget)
        button = QPushButton("Ação da Nova Aba")
        button.clicked.connect(self.some_action)
        layout.addWidget(button)

    def some_action(self):
        self.result_list.addItem("Ação executada na nova aba!")
        self.result_list.scrollToBottom()