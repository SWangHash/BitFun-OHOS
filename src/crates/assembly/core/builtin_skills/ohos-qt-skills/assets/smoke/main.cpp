// Environment smoke app (env_smoke.py). Exercises AUTOMOC (Q_OBJECT) and the
// Widgets stack so moc, the cross compiler, the Qt link and packaging all run.
#include <QApplication>
#include <QLabel>
#include <QObject>

class SmokeLabel : public QLabel
{
    Q_OBJECT
public:
    explicit SmokeLabel(QWidget *parent = nullptr) : QLabel(parent)
    {
        setText(QStringLiteral("Qt %1 HarmonyOS environment smoke").arg(QString::fromLatin1(qVersion())));
        setAlignment(Qt::AlignCenter);
    }
};

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    SmokeLabel label;
    label.resize(640, 360);
    label.show();
    return app.exec();
}

#include "main.moc"
