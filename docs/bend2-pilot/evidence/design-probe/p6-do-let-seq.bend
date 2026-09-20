import Base

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    x : U32 = 40
    y : U32 = 2
    IO.print(U32.show(U32.add(x, y)))
