import Base

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    u : Unit <- IO.print("first")
    IO.print("second")
