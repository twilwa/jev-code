import Base

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    +s : String = "ab"
    IO.print(String.append(s, "cd"))
